const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { Product } = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const { OrderRequest, ACTIVE_ORDER_STATUSES, CLOSED_ORDER_STATUSES } = require('../models/OrderRequest');
const { createOrderNotification } = require('../services/notificationService');
const { recordAuditLog } = require('../services/auditService');
const { recordStockMovement } = require('../services/stockMovementService');
const { getOrderReference, getReceiptReference, calculateOrderTotals } = require('../services/orderPresentationService');
const { buildOrderPdf, getOrderPdfFilename } = require('../services/orderPdfService');

const ALL_ORDER_STATUSES = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'];
const ZERO_STOCK_THRESHOLD = 0.000001;
const TRANSACTION_OPTIONS = {
  readPreference: 'primary',
  writeConcern: { w: 'majority' }
};

class OrderWorkflowError extends Error {
  constructor(message, redirectPath = '') {
    super(message);
    this.name = 'OrderWorkflowError';
    this.redirectPath = redirectPath;
  }
}

function workflowError(message, redirectPath = '') {
  return new OrderWorkflowError(message, redirectPath);
}

function redirectWorkflowError(req, res, error, fallbackPath) {
    if (!(error instanceof OrderWorkflowError)) {
        return false;
    }

    req.session.error = error.message;

    res.redirect(error.redirectPath || fallbackPath);

    return true;
}

function normalizeOrderForm(body, fallbackEmail = '', fallbackPhone = '', fallbackDeliveryNote = '') {
  return {
    requestedQuantity: body.requestedQuantity || '',
    buyerContactEmail: body.buyerContactEmail || fallbackEmail,
    buyerContactPhone: body.buyerContactPhone || fallbackPhone,
    deliveryNote: body.deliveryNote || fallbackDeliveryNote,
    message: body.message || ''
  };
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function orderSubject(order) {
  return order.productSnapshot?.name || 'produce request';
}

function pushHistory(order, action, actorRole, note = '') {
  order.history.push({
    action,
    actorRole,
    note,
    createdAt: new Date()
  });
}

function statusLabel(status) {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '';
}

function getOrderRedirectForRole(role, order) {
  const isClosed = order?.status && CLOSED_ORDER_STATUSES.includes(order.status);
  return `/dashboard/${role}/orders${isClosed ? '/history' : ''}`;
}

function safeScheduleDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scheduleDateForHistory(value) {
  if (!value) {
    return 'not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'not set';
  }

  return date.toISOString().slice(0, 10);
}

function scheduleSummary(order) {
  const fulfillment = order.fulfillment || {};
  const method = fulfillment.method ? statusLabel(fulfillment.method) : 'Pickup/delivery';
  const date = scheduleDateForHistory(fulfillment.requestedDate);
  const time = fulfillment.requestedTime || 'time not set';
  const location = fulfillment.location || 'location not set';
  return `${method} on ${date} at ${time}. Location: ${location}.`;
}


function markReceiptCancelled(order, actorId, reason = '') {
  if (!order.receiptIssuedAt || order.receiptStatus === 'cancelled') {
    return false;
  }

  order.receiptStatus = 'cancelled';
  order.receiptCancelledAt = new Date();
  order.receiptCancelledBy = actorId || null;
  order.receiptCancellationReason = reason || 'Order was cancelled after receipt issuance.';

  pushHistory(
    order,
    'Receipt cancelled',
    'farmer',
    order.receiptCancellationReason
  );

  return true;
}

function buildOrderSearchFilter(req, role, isHistory) {
  const filters = {
    q: String(req.query.q || '').trim(),
    status: String(req.query.status || '').trim(),
    paymentStatus: String(req.query.paymentStatus || '').trim(),
    fulfillmentStatus: String(req.query.fulfillmentStatus || '').trim()
  };

  const baseStatuses = isHistory ? CLOSED_ORDER_STATUSES : ACTIVE_ORDER_STATUSES;
  const query = { [role]: req.session.user.id, status: { $in: baseStatuses } };

  if (baseStatuses.includes(filters.status)) {
    query.status = filters.status;
  }

  if (['unpaid', 'paid'].includes(filters.paymentStatus)) {
    query.paymentStatus = filters.paymentStatus;
  }

  if (['not_scheduled', 'requested', 'reschedule_requested', 'confirmed', 'completed', 'cancelled'].includes(filters.fulfillmentStatus)) {
    query['fulfillment.status'] = filters.fulfillmentStatus;
  }

  if (filters.q) {
    const pattern = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { 'productSnapshot.name': pattern },
      { 'productSnapshot.category': pattern },
      { 'productSnapshot.location': pattern },
      { 'buyerSnapshot.name': pattern },
      { 'buyerSnapshot.email': pattern },
      { 'farmerSnapshot.name': pattern },
      { 'farmerSnapshot.email': pattern },
      { 'farmerSnapshot.farmName': pattern },
      { buyerContactEmail: pattern },
      { buyerContactPhone: pattern },
      { message: pattern },
      { farmerResponse: pattern }
    ];
  }

  return { query, filters, baseStatuses };
}

function canManageFulfillment(order) {
  return order && ['accepted', 'completed'].includes(order.status) && !['rejected', 'cancelled'].includes(order.status);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function markProductUnavailableIfEmpty(product, session) {
  if (!product) {
    return;
  }

  if (toNumber(product.quantity) <= ZERO_STOCK_THRESHOLD && product.status !== 'removed') {
    product.quantity = 0;
    product.status = 'unavailable';
    await product.save({ session });
  }
}

async function reserveInventoryForOrder(order, farmerId, session) {
  if (order.inventoryDeducted) {
    return { ok: true, product: null };
  }

  const requestedQuantity = toNumber(order.requestedQuantity);

  if (requestedQuantity <= 0) {
    throw workflowError('The requested quantity is invalid.', '/dashboard/farmer/orders');
  }

  const product = await Product.findOneAndUpdate(
    {
      _id: order.product,
      farmer: farmerId,
      status: 'available',
      removedAt: null,
      quantity: { $gte: requestedQuantity }
    },
    {
      $inc: { quantity: -requestedQuantity }
    },
    {
      new: true,
      runValidators: true,
      session
    }
  );

  if (!product) {
    return { ok: false, product: null };
  }

  await markProductUnavailableIfEmpty(product, session);

  await recordStockMovement(
    {
      farmer: farmerId,
      product: product._id,
      order: order._id,
      movementType: 'reserved_for_order',
      quantityChange: -requestedQuantity,
      quantityAfter: product.quantity,
      unit: product.unit || order.unit,
      note: `Reserved for order ${order.productSnapshot?.name || ''}`.trim(),
      actorRole: 'farmer',
      createdBy: farmerId
    },
    { session }
  );

  order.inventoryDeducted = true;
  order.inventoryDeductedAt = new Date();
  order.inventoryRestoredAt = null;

  pushHistory(
    order,
    'Inventory reserved',
    'system',
    `${requestedQuantity} ${order.unit} reserved from the farmer's available stock.`
  );

  return { ok: true, product };
}

async function restoreInventoryForCancelledAcceptedOrder(order, session) {
  if (!order.inventoryDeducted) {
    return false;
  }

  const product = await Product.findById(order.product).session(session);

  if (!product) {
    pushHistory(order, 'Inventory restore skipped', 'system', 'The original product listing could not be found.');
    return false;
  }

  product.quantity = toNumber(product.quantity) + toNumber(order.requestedQuantity);

  if (product.status !== 'removed') {
    product.status = 'available';
    product.removedAt = null;
  }

  await product.save({ session });

  await recordStockMovement(
    {
      farmer: product.farmer,
      product: product._id,
      order: order._id,
      movementType: 'restored_from_cancellation',
      quantityChange: toNumber(order.requestedQuantity),
      quantityAfter: product.quantity,
      unit: product.unit || order.unit,
      note: 'Stock restored because an accepted order was cancelled.',
      actorRole: order.cancelledByRole || 'system',
      createdBy: order.cancelledByRole === 'farmer' ? order.farmer : order.buyer
    },
    { session }
  );

  order.inventoryDeducted = false;
  order.inventoryRestoredAt = new Date();

  pushHistory(
    order,
    'Inventory restored',
    'system',
    `${order.requestedQuantity} ${order.unit} returned to the farmer's available stock.`
  );

  return true;
}

async function findAvailableProduct(productId) {
  if (!isValidObjectId(productId)) {
    return null;
  }

  const product = await Product.findOne({ _id: productId, status: 'available', removedAt: null, quantity: { $gt: 0 } })
    .populate('farmer', 'name email accountStatus farmerProfile profileImage')
    .lean();

  if (!product || !product.farmer || (product.farmer.accountStatus || 'active') !== 'active') {
    return null;
  }

  return product;
}

function populateOrderQuery(query) {
  return query
    .populate('product', 'name status image quantity unit')
    .populate('farmer', 'name email accountStatus farmerProfile profileImage')
    .populate('buyer', 'name email buyerProfile profileImage');
}

async function requestProductForm(req, res, next) {
  try {
    const product = await findAvailableProduct(req.params.productId);

    if (!product) {
      req.session.error = 'That product is no longer available.';
      return res.redirect('/dashboard/buyer/marketplace');
    }

    const buyer = await User.findById(req.session.user.id).lean();
    const deliveryNote = buyer?.buyerProfile?.deliveryAddress
      ? `Preferred delivery address: ${buyer.buyerProfile.deliveryAddress}`
      : '';

    return res.render('orders/request-form', {
      title: `Request ${product.name}`,
      product,
      formData: normalizeOrderForm({}, buyer?.email || req.session.user.email, buyer?.buyerProfile?.phone || '', deliveryNote),
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

async function createOrderRequest(req, res, next) {
  try {
    const product = await findAvailableProduct(req.params.productId);

    if (!product) {
      req.session.error = 'That product is no longer available.';
      return res.redirect('/dashboard/buyer/marketplace');
    }

    const result = validationResult(req);
    const formData = normalizeOrderForm(req.body, req.session.user.email);

    if (!result.isEmpty()) {
      return res.status(422).render('orders/request-form', {
        title: `Request ${product.name}`,
        product,
        formData,
        errors: result.array()
      });
    }

    if (toNumber(req.body.requestedQuantity) > toNumber(product.quantity)) {
      return res.status(422).render('orders/request-form', {
        title: `Request ${product.name}`,
        product,
        formData,
        errors: [{ msg: `Requested quantity cannot be more than the available quantity of ${product.quantity} ${product.unit}.` }]
      });
    }

    const buyer = await User.findById(req.session.user.id).lean();
    const totals = calculateOrderTotals({
      unitPrice: product.price,
      quantity: req.body.requestedQuantity,
      vatMode: product.vatMode || 'none',
      vatRate: product.vatRate || 0
    });

    const order = await OrderRequest.create({
      buyer: req.session.user.id,
      farmer: product.farmer._id,
      product: product._id,
      requestedQuantity: req.body.requestedQuantity,
      unit: product.unit,
      buyerContactEmail: req.body.buyerContactEmail,
      buyerContactPhone: req.body.buyerContactPhone || '',
      deliveryNote: req.body.deliveryNote || '',
      message: req.body.message || '',
      productSnapshot: {
        name: product.name,
        category: product.category,
        price: product.price,
        currency: product.currency,
        vatMode: product.vatMode || 'none',
        vatRate: product.vatRate || 0,
        subtotalExVat: totals.subtotalExVat,
        vatAmount: totals.vatAmount,
        totalPrice: totals.totalPrice,
        location: product.location,
        imagePath: product.image?.path || '',
        quantityAvailableAtRequest: product.quantity
      },
      buyerSnapshot: {
        name: buyer?.buyerProfile?.organization || buyer?.buyerProfile?.contactName || buyer?.name || req.session.user.name,
        email: buyer?.email || req.session.user.email
      },
      farmerSnapshot: {
        name: product.farmer?.name || '',
        email: product.farmer?.email || '',
        farmName: product.farmer?.farmerProfile?.farmName || ''
      },
      farmerPaymentSnapshot: getFarmerPaymentSnapshot(product.farmer),
      history: [
        {
          action: 'Request created',
          actorRole: 'buyer',
          note: req.body.message || '',
          createdAt: new Date()
        }
      ]
    });

    await Product.updateOne(
      { _id: product._id },
      { $inc: { 'analytics.requestCount': 1 } }
    );

    await recordAuditLog(req, {
      action: 'order.created',
      targetType: 'OrderRequest',
      target: order._id,
      targetLabel: order.productSnapshot?.name || 'Order request',
      message: 'Buyer created an order request.',
      metadata: { farmer: String(order.farmer), requestedQuantity: order.requestedQuantity, totalPrice: order.productSnapshot?.totalPrice }
    });

    await createOrderNotification({
      recipient: product.farmer._id,
      actor: req.session.user.id,
      actorRole: 'buyer',
      title: 'New buyer request',
      message: `${buyer?.name || req.session.user.name} requested ${order.requestedQuantity} ${order.unit} of ${orderSubject(order)}.`,
      link: '/dashboard/farmer/orders'
    });

    req.session.success = 'Your request has been sent to the farmer.';
    return res.redirect('/dashboard/buyer/orders');
  } catch (error) {
    return next(error);
  }
}

async function buyerOrders(req, res, next) {
  try {
    const { query, filters, baseStatuses } = buildOrderSearchFilter(req, 'buyer', false);
    const orders = await populateOrderQuery(OrderRequest.find(query))
      .sort({ createdAt: -1 })
      .lean();

    return res.render('orders/buyer-index', {
      title: 'My active requests',
      orders,
      isHistory: false,
      filters,
      statuses: baseStatuses
    });
  } catch (error) {
    return next(error);
  }
}


async function buyerOrderHistory(req, res, next) {
  try {
    const { query, filters, baseStatuses } = buildOrderSearchFilter(req, 'buyer', true);
    const orders = await populateOrderQuery(OrderRequest.find(query))
      .sort({ updatedAt: -1 })
      .lean();

    return res.render('orders/buyer-index', {
      title: 'Buyer order history',
      orders,
      isHistory: true,
      filters,
      statuses: baseStatuses
    });
  } catch (error) {
    return next(error);
  }
}


async function farmerOrders(req, res, next) {
  try {
    const { query, filters, baseStatuses } = buildOrderSearchFilter(req, 'farmer', false);
    const orders = await populateOrderQuery(OrderRequest.find(query))
      .sort({ createdAt: -1 })
      .lean();

    return res.render('orders/farmer-index', {
      title: 'Active buyer requests',
      orders,
      selectedStatus: filters.status,
      statuses: baseStatuses,
      filters,
      isHistory: false
    });
  } catch (error) {
    return next(error);
  }
}


async function farmerOrderHistory(req, res, next) {
  try {
    const { query, filters, baseStatuses } = buildOrderSearchFilter(req, 'farmer', true);
    const orders = await populateOrderQuery(OrderRequest.find(query))
      .sort({ updatedAt: -1 })
      .lean();

    return res.render('orders/farmer-index', {
      title: 'Farmer order history',
      orders,
      selectedStatus: filters.status,
      statuses: baseStatuses,
      filters,
      isHistory: true
    });
  } catch (error) {
    return next(error);
  }
}


async function cancelBuyerOrder(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    let order;
    let previousStatus = '';

    await mongoose.connection.transaction(async (session) => {
      order = await OrderRequest.findOne({
        _id: req.params.id,
        buyer: req.session.user.id
      }).session(session);

      if (!order) {
        throw workflowError('Request not found.', '/dashboard/buyer/orders');
      }

      if (!['pending', 'accepted'].includes(order.status)) {
        throw workflowError('Only pending or accepted requests can be cancelled.', '/dashboard/buyer/orders');
      }

      if (order.receiptIssuedAt || order.receiptStatus === 'issued') {
        throw workflowError(
          'A buyer cannot cancel an order after a receipt has been issued. Contact the farmer through in-app messaging.',
          '/dashboard/buyer/orders'
        );
      }

      previousStatus = order.status;
      const wasAccepted = order.status === 'accepted';

      order.cancelledAt = new Date();
      order.cancelledByRole = 'buyer';

      if (wasAccepted) {
        await restoreInventoryForCancelledAcceptedOrder(order, session);
      }

      order.status = 'cancelled';
      order.respondedAt = new Date();

      pushHistory(
        order,
        'Request cancelled',
        'buyer',
        wasAccepted
          ? 'Buyer cancelled the accepted request. Reserved inventory was returned when possible.'
          : 'Buyer cancelled the pending request.'
      );

      await order.save({ session });
    }, TRANSACTION_OPTIONS);

    await recordAuditLog(req, {
      action: 'order.cancelled',
      targetType: 'OrderRequest',
      target: order._id,
      targetLabel: order.productSnapshot?.name || 'Order request',
      message: 'Buyer cancelled an order request.',
      metadata: { previousStatus }
    });

    await createOrderNotification({
      recipient: order.farmer,
      actor: req.session.user.id,
      actorRole: 'buyer',
      title: 'Request cancelled by buyer',
      message: `${order.buyerSnapshot?.name || req.session.user.name} cancelled the request for ${orderSubject(order)}.`,
      link: '/dashboard/farmer/orders/history'
    });

    req.session.success = 'Your request has been cancelled.';
    return res.redirect('/dashboard/buyer/orders/history');
  } catch (error) {
      const handled = redirectWorkflowError(
          req,
          res,
          error,
          '/dashboard/buyer/orders/history'
      );

      if (handled) {
          return;
      }

      return next(error);
  }
}

async function updateFarmerOrderStatus(req, res, next) {
  try {
    const result = validationResult(req);

    if (!result.isEmpty()) {
      req.session.error = result.array()[0].msg;
      return res.redirect('/dashboard/farmer/orders');
    }

    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    const nextStatus = req.body.status;
    let order;

    await mongoose.connection.transaction(async (session) => {
      order = await OrderRequest.findOne({
        _id: req.params.id,
        farmer: req.session.user.id
      }).session(session);

      if (!order) {
        throw workflowError('Request not found.', '/dashboard/farmer/orders');
      }

      if (CLOSED_ORDER_STATUSES.includes(order.status)) {
        throw workflowError('This request is already closed.', '/dashboard/farmer/orders/history');
      }

      if (nextStatus === 'completed') {
        throw workflowError(
          'Record successful payment and issue a receipt to complete this order.',
          '/dashboard/farmer/orders'
        );
      }

      if (nextStatus === 'cancelled' && order.status !== 'accepted') {
        throw workflowError(
          'Only accepted requests can be cancelled by the farmer. Reject pending requests instead.',
          '/dashboard/farmer/orders'
        );
      }

      if (['accepted', 'rejected'].includes(nextStatus) && order.status !== 'pending') {
        throw workflowError('Only pending requests can be accepted or rejected.', '/dashboard/farmer/orders');
      }

      if (nextStatus === 'accepted') {
        const inventoryResult = await reserveInventoryForOrder(order, req.session.user.id, session);

        if (!inventoryResult.ok) {
          throw workflowError(
            `This request cannot be accepted because there is not enough available stock for ${orderSubject(order)}. Update the product quantity or reject the request.`,
            '/dashboard/farmer/orders'
          );
        }

        const farmer = await User.findById(req.session.user.id).session(session).lean();
        order.farmerPaymentSnapshot = getFarmerPaymentSnapshot(farmer);
      }

      if (nextStatus === 'cancelled') {
        order.cancelledAt = new Date();
        order.cancelledByRole = 'farmer';

        if (order.receiptIssuedAt || order.receiptStatus === 'issued') {
          markReceiptCancelled(
            order,
            req.session.user.id,
            req.body.farmerResponse || 'Farmer cancelled the order after receipt issuance.'
          );

          const productForMovement = await Product.findById(order.product)
            .select('quantity unit farmer')
            .session(session)
            .lean();

          if (productForMovement) {
            await recordStockMovement(
              {
                farmer: productForMovement.farmer,
                product: order.product,
                order: order._id,
                movementType: 'order_cancelled_after_receipt',
                quantityChange: 0,
                quantityAfter: productForMovement.quantity,
                unit: productForMovement.unit || order.unit,
                note: 'Order cancelled after receipt issuance; receipt marked cancelled.',
                actorRole: 'farmer',
                createdBy: req.session.user.id
              },
              { session }
            );
          }
        }

        await restoreInventoryForCancelledAcceptedOrder(order, session);
      }

      order.status = nextStatus;
      order.farmerResponse = req.body.farmerResponse || order.farmerResponse || '';
      order.respondedAt = new Date();

      pushHistory(
        order,
        `Request ${statusLabel(nextStatus).toLowerCase()}`,
        'farmer',
        req.body.farmerResponse || `Farmer marked the request as ${nextStatus}.`
      );

      await order.save({ session });
    }, TRANSACTION_OPTIONS);

    await recordAuditLog(req, {
      action: nextStatus === 'cancelled' ? 'order.cancelled' : 'order.status_updated',
      targetType: 'OrderRequest',
      target: order._id,
      targetLabel: order.productSnapshot?.name || 'Order request',
      message: `Farmer marked order as ${nextStatus}.`,
      metadata: { nextStatus, farmerResponse: order.farmerResponse }
    });

    const notificationTitles = {
      accepted: 'Request accepted',
      rejected: 'Request rejected',
      completed: 'Request completed',
      cancelled: 'Request cancelled by farmer'
    };

    await createOrderNotification({
      recipient: order.buyer,
      actor: req.session.user.id,
      actorRole: 'farmer',
      title: notificationTitles[nextStatus] || 'Request updated',
      message: nextStatus === 'accepted'
        ? `Your request for ${orderSubject(order)} was accepted. Open the order to view the farmer's payment details before making payment.`
        : nextStatus === 'cancelled' && order.receiptStatus === 'cancelled'
          ? `The farmer cancelled your order for ${orderSubject(order)} after receipt issuance. The receipt has been marked cancelled.`
          : `Your request for ${orderSubject(order)} was marked as ${nextStatus}.`,
      link: CLOSED_ORDER_STATUSES.includes(nextStatus) ? '/dashboard/buyer/orders/history' : '/dashboard/buyer/orders'
    });

    const inventoryNote = nextStatus === 'accepted' ? ' Available quantity has been reduced.' : '';
    req.session.success = `Request marked as ${nextStatus}.${inventoryNote}`;
    return res.redirect(CLOSED_ORDER_STATUSES.includes(nextStatus) ? '/dashboard/farmer/orders/history' : '/dashboard/farmer/orders');
  } catch (error) {
      const handled = redirectWorkflowError(
          req,
          res,
          error,
          '/dashboard/farmer/orders'
      );

      if (handled) {
          return;
      }

      return next(error);
  }
}


async function requestBuyerSchedule(req, res, next) {
  try {
    const result = validationResult(req);

    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    const order = await OrderRequest.findOne({ _id: req.params.id, buyer: req.session.user.id });

    if (!order) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    if (!canManageFulfillment(order) || order.status !== 'accepted') {
      req.session.error = 'Pickup or delivery can only be scheduled after the farmer accepts the order.';
      return res.redirect(getOrderRedirectForRole('buyer', order));
    }

    if (order.fulfillment?.status === 'completed') {
      req.session.error = 'This pickup or delivery is already completed.';
      return res.redirect(getOrderRedirectForRole('buyer', order));
    }

    if (!result.isEmpty()) {
      req.session.error = result.array()[0].msg;
      return res.redirect(getOrderRedirectForRole('buyer', order));
    }

    order.fulfillment = {
      ...(order.fulfillment || {}),
      method: req.body.method,
      status: 'requested',
      requestedDate: safeScheduleDate(req.body.requestedDate),
      requestedTime: req.body.requestedTime || '',
      location: req.body.location || '',
      note: req.body.note || '',
      farmerProposedDate: null,
      farmerProposedTime: '',
      farmerProposedLocation: '',
      farmerNote: '',
      confirmedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedByRole: 'buyer'
    };

    pushHistory(order, 'Pickup/delivery requested', 'buyer', scheduleSummary(order));
    await order.save();

    await recordAuditLog(req, {
      action: 'order.fulfillment_requested',
      targetType: 'OrderRequest',
      target: order._id,
      targetLabel: order.productSnapshot?.name || 'Order request',
      message: 'Buyer requested pickup or delivery scheduling.',
      metadata: { fulfillment: order.fulfillment }
    });

    await createOrderNotification({
      recipient: order.farmer,
      actor: req.session.user.id,
      actorRole: 'buyer',
      title: 'Pickup/delivery requested',
      message: `${order.buyerSnapshot?.name || req.session.user.name} requested ${order.fulfillment.method} for ${orderSubject(order)}. ${scheduleSummary(order)}`,
      link: '/dashboard/farmer/orders'
    });

    req.session.success = 'Pickup/delivery request sent to the farmer.';
    return res.redirect('/dashboard/buyer/orders');
  } catch (error) {
    return next(error);
  }
}

async function confirmBuyerScheduleProposal(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    const order = await OrderRequest.findOne({ _id: req.params.id, buyer: req.session.user.id });

    if (!order) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    if (order.status !== 'accepted' || order.fulfillment?.status !== 'reschedule_requested') {
      req.session.error = 'There is no farmer schedule proposal to confirm.';
      return res.redirect(getOrderRedirectForRole('buyer', order));
    }

    order.fulfillment.requestedDate = order.fulfillment.farmerProposedDate || order.fulfillment.requestedDate;
    order.fulfillment.requestedTime = order.fulfillment.farmerProposedTime || order.fulfillment.requestedTime;
    order.fulfillment.location = order.fulfillment.farmerProposedLocation || order.fulfillment.location;
    order.fulfillment.note = order.fulfillment.note || '';
    order.fulfillment.status = 'confirmed';
    order.fulfillment.confirmedAt = new Date();
    order.fulfillment.updatedByRole = 'buyer';

    pushHistory(order, 'Pickup/delivery proposal confirmed', 'buyer', scheduleSummary(order));
    await order.save();

    await recordAuditLog(req, {
      action: 'order.fulfillment_confirmed_by_buyer',
      targetType: 'OrderRequest',
      target: order._id,
      targetLabel: order.productSnapshot?.name || 'Order request',
      message: 'Buyer confirmed the farmer pickup/delivery proposal.',
      metadata: { fulfillment: order.fulfillment }
    });

    await createOrderNotification({
      recipient: order.farmer,
      actor: req.session.user.id,
      actorRole: 'buyer',
      title: 'Pickup/delivery confirmed',
      message: `${order.buyerSnapshot?.name || req.session.user.name} confirmed the pickup/delivery proposal for ${orderSubject(order)}. ${scheduleSummary(order)}`,
      link: '/dashboard/farmer/orders'
    });

    req.session.success = 'Pickup/delivery proposal confirmed.';
    return res.redirect('/dashboard/buyer/orders');
  } catch (error) {
    return next(error);
  }
}

async function updateFarmerSchedule(req, res, next) {
  try {
    const result = validationResult(req);

    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    if (!result.isEmpty()) {
      req.session.error = result.array()[0].msg;
      return res.redirect('/dashboard/farmer/orders');
    }

    const action = req.body.scheduleAction;
    const note = req.body.farmerNote || '';
    let order;

    await mongoose.connection.transaction(async (session) => {
      order = await OrderRequest.findOne({
        _id: req.params.id,
        farmer: req.session.user.id
      }).session(session);

      if (!order) {
        throw workflowError('Order not found.', '/dashboard/farmer/orders');
      }

      if (!canManageFulfillment(order) || order.status !== 'accepted') {
        throw workflowError(
          'Pickup or delivery can only be managed for accepted active orders.',
          getOrderRedirectForRole('farmer', order)
        );
      }

      if (!['confirm', 'reschedule', 'complete', 'cancel_schedule'].includes(action)) {
        throw workflowError('Choose a valid pickup or delivery action.', '/dashboard/farmer/orders');
      }

      const currentStatus = order.fulfillment?.status || 'not_scheduled';

      if (action === 'confirm') {
        if (!['requested', 'reschedule_requested', 'cancelled', 'not_scheduled'].includes(currentStatus)) {
          throw workflowError('This pickup/delivery cannot be confirmed in its current state.', '/dashboard/farmer/orders');
        }

        if (!order.fulfillment?.requestedDate || !order.fulfillment?.requestedTime || !order.fulfillment?.location) {
          throw workflowError('The buyer must request a date, time, and location before you confirm.', '/dashboard/farmer/orders');
        }

        order.fulfillment.status = 'confirmed';
        order.fulfillment.confirmedAt = new Date();
        order.fulfillment.farmerNote = note || order.fulfillment.farmerNote || '';
        order.fulfillment.updatedByRole = 'farmer';
        pushHistory(order, 'Pickup/delivery confirmed', 'farmer', note || scheduleSummary(order));
      }

      if (action === 'reschedule') {
        if (!req.body.farmerProposedDate || !req.body.farmerProposedTime || !req.body.farmerProposedLocation) {
          throw workflowError('Proposed date, time, and location are required when suggesting a change.', '/dashboard/farmer/orders');
        }

        order.fulfillment = {
          ...(order.fulfillment || {}),
          method: order.fulfillment?.method || 'pickup',
          status: 'reschedule_requested',
          farmerProposedDate: safeScheduleDate(req.body.farmerProposedDate),
          farmerProposedTime: req.body.farmerProposedTime || '',
          farmerProposedLocation: req.body.farmerProposedLocation || '',
          farmerNote: note,
          updatedByRole: 'farmer'
        };
        pushHistory(order, 'Pickup/delivery change suggested', 'farmer', note || 'Farmer suggested a different pickup/delivery schedule.');
      }

      if (action === 'complete') {
        if (!order.receiptIssuedAt || order.paymentStatus !== 'paid') {
          throw workflowError('Record payment and issue the receipt before marking pickup/delivery as completed.', '/dashboard/farmer/orders');
        }

        if (!['confirmed', 'requested', 'reschedule_requested'].includes(currentStatus)) {
          throw workflowError('Confirm or request the pickup/delivery schedule before marking it completed.', '/dashboard/farmer/orders');
        }

        order.fulfillment.status = 'completed';
        order.fulfillment.completedAt = new Date();
        order.fulfillment.updatedByRole = 'farmer';
        order.status = 'completed';
        order.respondedAt = new Date();
        pushHistory(order, 'Request completed', 'farmer', note || 'Farmer marked the request complete after payment and pickup/delivery.');
        pushHistory(order, 'Pickup/delivery completed', 'farmer', note || 'Farmer marked the pickup/delivery as completed.');

        const productAfterCompletion = await Product.findById(order.product)
          .select('quantity unit farmer')
          .session(session)
          .lean();

        if (productAfterCompletion) {
          await recordStockMovement(
            {
              farmer: productAfterCompletion.farmer,
              product: order.product,
              order: order._id,
              movementType: 'order_completed',
              quantityChange: 0,
              quantityAfter: productAfterCompletion.quantity,
              unit: productAfterCompletion.unit || order.unit,
              note: 'Order completed after payment and pickup/delivery.',
              actorRole: 'farmer',
              createdBy: req.session.user.id
            },
            { session }
          );
        }
      }

      if (action === 'cancel_schedule') {
        if (currentStatus === 'completed') {
          throw workflowError('A completed pickup/delivery schedule cannot be cancelled.', '/dashboard/farmer/orders');
        }

        order.fulfillment.status = 'cancelled';
        order.fulfillment.cancelledAt = new Date();
        order.fulfillment.farmerNote = note || order.fulfillment.farmerNote || '';
        order.fulfillment.updatedByRole = 'farmer';
        pushHistory(order, 'Pickup/delivery cancelled', 'farmer', note || 'Farmer cancelled the pickup/delivery schedule.');
      }

      await order.save({ session });
    }, TRANSACTION_OPTIONS);

    await recordAuditLog(req, {
      action: `order.fulfillment_${action}`,
      targetType: 'OrderRequest',
      target: order._id,
      targetLabel: order.productSnapshot?.name || 'Order request',
      message: `Farmer updated pickup/delivery schedule: ${action}.`,
      metadata: { fulfillment: order.fulfillment }
    });

    const actionMessages = {
      confirm: 'The farmer confirmed pickup/delivery for your order.',
      reschedule: 'The farmer suggested a different pickup/delivery schedule for your order.',
      complete: 'The farmer marked pickup/delivery as completed for your order.',
      cancel_schedule: 'The farmer cancelled the pickup/delivery schedule for your order.'
    };

    await createOrderNotification({
      recipient: order.buyer,
      actor: req.session.user.id,
      actorRole: 'farmer',
      title: 'Pickup/delivery updated',
      message: `${actionMessages[action] || 'The farmer updated pickup/delivery details for your order.'} ${scheduleSummary(order)}`,
      link: action === 'complete' ? '/dashboard/buyer/orders/history' : '/dashboard/buyer/orders'
    });

    req.session.success = action === 'complete' ? 'Pickup/delivery completed and order moved to history.' : 'Pickup/delivery schedule updated.';
    return res.redirect(action === 'complete' ? '/dashboard/farmer/orders/history' : '/dashboard/farmer/orders');
  } catch (error) {
      const handled = redirectWorkflowError(
          req,
          res,
          error,
          '/dashboard/farmer/orders'
      );

      if (handled) {
          return;
      }

      return next(error);
  }
}


async function showBuyerOrder(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    const order = await populateOrderQuery(
      OrderRequest.findOne({ _id: req.params.id, buyer: req.session.user.id })
    ).lean();

    if (!order) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    return res.render('orders/show', {
      title: `Order detail ${getOrderReference(order)}`,
      order,
      viewerRole: 'buyer',
      generatedAt: new Date(),
      autoPrint: false
    });
  } catch (error) {
    return next(error);
  }
}

async function showFarmerOrder(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    const order = await populateOrderQuery(
      OrderRequest.findOne({ _id: req.params.id, farmer: req.session.user.id })
    ).lean();

    if (!order) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    return res.render('orders/show', {
      title: `Order detail ${getOrderReference(order)}`,
      order,
      viewerRole: 'farmer',
      generatedAt: new Date(),
      autoPrint: false
    });
  } catch (error) {
    return next(error);
  }
}


async function viewBuyerReceipt(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Receipt not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    const order = await populateOrderQuery(
      OrderRequest.findOne({ _id: req.params.id, buyer: req.session.user.id })
    ).lean();

    if (!order) {
      req.session.error = 'Receipt not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    if (!order.receiptIssuedAt) {
      req.session.error = 'A farmer-issued receipt is not available for this order yet.';
      return res.redirect(getOrderRedirectForRole('buyer', order));
    }

    return res.render('orders/print', {
      title: `Receipt ${getReceiptReference(order)}`,
      order,
      viewerRole: 'buyer',
      generatedAt: new Date(),
      autoPrint: false
    });
  } catch (error) {
    return next(error);
  }
}

async function viewFarmerReceipt(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Receipt not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    const order = await populateOrderQuery(
      OrderRequest.findOne({ _id: req.params.id, farmer: req.session.user.id })
    ).lean();

    if (!order) {
      req.session.error = 'Receipt not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    if (!order.receiptIssuedAt) {
      req.session.error = 'A farmer-issued receipt is not available for this order yet.';
      return res.redirect(getOrderRedirectForRole('farmer', order));
    }

    return res.render('orders/print', {
      title: `Receipt ${getReceiptReference(order)}`,
      order,
      viewerRole: 'farmer',
      generatedAt: new Date(),
      autoPrint: false
    });
  } catch (error) {
    return next(error);
  }
}

function sendOrderPdfDownload(res, order, pdfBuffer) {
  const filename = getOrderPdfFilename(order);

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': pdfBuffer.length,
    'Cache-Control': 'private, no-store'
  });

  return res.send(pdfBuffer);
}

async function printBuyerOrder(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    const order = await populateOrderQuery(
      OrderRequest.findOne({ _id: req.params.id, buyer: req.session.user.id })
    ).lean();

    if (!order) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/buyer/orders');
    }

    const pdfBuffer = await buildOrderPdf(order);
    return sendOrderPdfDownload(res, order, pdfBuffer);
  } catch (error) {
    return next(error);
  }
}

async function printFarmerOrder(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    const order = await populateOrderQuery(
      OrderRequest.findOne({ _id: req.params.id, farmer: req.session.user.id })
    ).lean();

    if (!order) {
      req.session.error = 'Request not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    const pdfBuffer = await buildOrderPdf(order);
    return sendOrderPdfDownload(res, order, pdfBuffer);
  } catch (error) {
    return next(error);
  }
}


function getFarmerPaymentSnapshot(farmer) {
  return {
    bankName: farmer?.farmerProfile?.bankName || '',
    bankAccountNumber: farmer?.farmerProfile?.bankAccountNumber || '',
    mpaisaNumber: farmer?.farmerProfile?.mpaisaNumber || '',
    mycashNumber: farmer?.farmerProfile?.mycashNumber || ''
  };
}

async function issueFarmerReceipt(req, res, next) {
  try {
    const result = validationResult(req);

    if (!result.isEmpty()) {
      req.session.error = result.array()[0].msg;
      return res.redirect('/dashboard/farmer/orders');
    }

    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/farmer/orders');
    }

    const amountPaid = toNumber(req.body.amountPaid);
    const paymentMethod = req.body.paymentMethod;
    const paymentReference = req.body.paymentReference || '';
    const receiptNote = req.body.receiptNote || '';
    const issuedAt = new Date();
    let order;

    await mongoose.connection.transaction(async (session) => {
      order = await OrderRequest.findOne({
        _id: req.params.id,
        farmer: req.session.user.id
      }).session(session);

      if (!order) {
        throw workflowError('Order not found.', '/dashboard/farmer/orders');
      }

      if (order.receiptIssuedAt) {
        throw workflowError('A receipt has already been issued for this order.', '/dashboard/farmer/orders/history');
      }

      if (!['accepted', 'completed'].includes(order.status)) {
        throw workflowError(
          'A receipt can only be issued after the order has been accepted and payment has been received.',
          '/dashboard/farmer/orders'
        );
      }

      const farmer = await User.findById(req.session.user.id).session(session).lean();

      order.paymentStatus = 'paid';
      order.receiptStatus = 'issued';
      order.paymentMethod = paymentMethod;
      order.amountPaid = amountPaid;
      order.paymentReference = paymentReference;
      order.paymentConfirmedAt = issuedAt;
      order.receiptIssuedAt = issuedAt;
      order.receiptIssuedBy = req.session.user.id;
      order.receiptNote = receiptNote;
      order.farmerPaymentSnapshot = getFarmerPaymentSnapshot(farmer);
        if (order.status !== 'completed') {
            order.status = 'accepted';
        }
      order.respondedAt = issuedAt;

      pushHistory(
        order,
        'Payment received',
        'farmer',
        `Payment of ${amountPaid.toFixed(2)} recorded by farmer.`
      );

      pushHistory(
        order,
        'Receipt issued',
        'farmer',
        receiptNote || 'Receipt issued by farmer after successful payment.'
      );

      await order.save({ session });
    }, TRANSACTION_OPTIONS);

    await recordAuditLog(req, {
      action: 'order.receipt_issued',
      targetType: 'OrderRequest',
      target: order._id,
      targetLabel: order.productSnapshot?.name || 'Order request',
      message: 'Farmer recorded payment and issued a receipt.',
      metadata: { paymentMethod, amountPaid, receiptIssuedAt: issuedAt }
    });

    await createOrderNotification({
      recipient: order.buyer,
      actor: req.session.user.id,
      actorRole: 'farmer',
      title: 'Receipt issued',
      message: `The farmer issued a receipt for your ${orderSubject(order)} order.`,
      link: `/dashboard/buyer/orders/${order._id}/receipt`
    });

    req.session.success = 'Payment recorded and receipt issued successfully.';
    return res.redirect(`/dashboard/farmer/orders/${order._id}/receipt`);
  } catch (error) {
      const handled = redirectWorkflowError(
          req,
          res,
          error,
          '/dashboard/farmer/orders'
      );

      if (handled) {
          return;
      }

      return next(error);
  }
}


module.exports = {
  requestProductForm,
  createOrderRequest,
  buyerOrders,
  buyerOrderHistory,
  farmerOrders,
  farmerOrderHistory,
  cancelBuyerOrder,
  updateFarmerOrderStatus,
  requestBuyerSchedule,
  confirmBuyerScheduleProposal,
  updateFarmerSchedule,
  showBuyerOrder,
  showFarmerOrder,
  viewBuyerReceipt,
  viewFarmerReceipt,
  printBuyerOrder,
  printFarmerOrder,
  issueFarmerReceipt
};
