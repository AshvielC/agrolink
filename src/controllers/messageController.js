const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const Message = require('../models/Message');
const User = require('../models/User');
const { Product } = require('../models/Product');
const { OrderRequest } = require('../models/OrderRequest');
const { createUserMessage, displayName } = require('../services/messageService');
const { getOrderReference } = require('../services/orderPresentationService');
const { recordAuditLog } = require('../services/auditService');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function dashboardFor(role) {
  if (role === 'buyer') return '/dashboard/buyer';
  if (role === 'farmer') return '/dashboard/farmer';
  if (role === 'admin') return '/dashboard/admin';
  return '/dashboard';
}

function normalizeForm(body = {}, fallback = {}) {
  return {
    subject: body.subject || fallback.subject || '',
    body: body.body || fallback.body || ''
  };
}

function populateMessageQuery(query) {
  return query
    .populate('sender', 'name email role farmerProfile buyerProfile profileImage accountStatus')
    .populate('recipient', 'name email role farmerProfile buyerProfile profileImage accountStatus')
    .populate('relatedProduct', 'name category location')
    .populate('relatedOrder', 'status productSnapshot buyerSnapshot farmerSnapshot');
}

async function listInbox(req, res, next) {
  try {
    const messages = await populateMessageQuery(
      Message.find({ recipient: req.session.user.id })
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.render('messages/index', {
      title: 'Message inbox',
      messages,
      mode: 'inbox'
    });
  } catch (error) {
    return next(error);
  }
}

async function listSent(req, res, next) {
  try {
    const messages = await populateMessageQuery(
      Message.find({ sender: req.session.user.id })
    )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.render('messages/index', {
      title: 'Sent messages',
      messages,
      mode: 'sent'
    });
  } catch (error) {
    return next(error);
  }
}

async function findMessageForUser(req) {
  if (!isValidObjectId(req.params.id)) return null;

  const query = { _id: req.params.id };

  if (req.session.user.role !== 'admin') {
    query.$or = [
      { sender: req.session.user.id },
      { recipient: req.session.user.id }
    ];
  }

  return populateMessageQuery(Message.findOne(query)).lean();
}

async function showMessage(req, res, next) {
  try {
    const message = await findMessageForUser(req);

    if (!message) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/messages');
    }

    if (String(message.recipient?._id || message.recipient) === String(req.session.user.id) && !message.readAt) {
      await Message.updateOne({ _id: message._id, recipient: req.session.user.id }, { readAt: new Date() });
      message.readAt = new Date();
    }

    return res.render('messages/show', {
      title: message.subject,
      message,
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function printMessage(req, res, next) {
  try {
    const message = await findMessageForUser(req);

    if (!message) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/messages');
    }

    return res.render('messages/show', {
      title: `Print message: ${message.subject}`,
      message,
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}

async function resolveRelatedContext(req, senderId, recipientId) {
  const context = {
    relatedProduct: null,
    relatedOrder: null,
    productSnapshot: {},
    orderSnapshot: {},
    subject: '',
    body: ''
  };

  if (req.query.productId && isValidObjectId(req.query.productId)) {
    const product = await Product.findOne({
      _id: req.query.productId,
      farmer: recipientId,
      removedAt: null
    }).lean();

    if (product) {
      context.relatedProduct = product._id;
      context.productSnapshot = {
        name: product.name || '',
        category: product.category || '',
        location: product.location || ''
      };
      context.subject = `Enquiry about ${product.name}`;
    }
  }

  if (req.query.orderId && isValidObjectId(req.query.orderId)) {
    const order = await OrderRequest.findOne({
      _id: req.query.orderId,
      $or: [
        { buyer: senderId, farmer: recipientId },
        { buyer: recipientId, farmer: senderId }
      ]
    }).lean();

    if (order) {
      context.relatedOrder = order._id;
      context.orderSnapshot = {
        reference: getOrderReference(order),
        productName: order.productSnapshot?.name || '',
        status: order.status || ''
      };
      context.subject = `Order ${getOrderReference(order)} - ${order.productSnapshot?.name || 'produce'}`;
    }
  }

  return context;
}

async function usersHaveTradingRelationship(senderId, recipientId) {
  const order = await OrderRequest.exists({
    $or: [
      { buyer: senderId, farmer: recipientId },
      { buyer: recipientId, farmer: senderId }
    ]
  });

  if (order) return true;

  return Boolean(await Message.exists({
    $or: [
      { sender: senderId, recipient: recipientId },
      { sender: recipientId, recipient: senderId }
    ]
  }));
}

async function canMessageRecipient(req, recipient, context) {
  if (req.session.user.role === 'admin') return true;
  if (!recipient || recipient.role === 'admin') return false;
  if (context.relatedOrder) return true;
  if (context.relatedProduct && req.session.user.role === 'buyer' && recipient.role === 'farmer') return true;
  return usersHaveTradingRelationship(req.session.user.id, recipient._id);
}

async function composeForm(req, res, next) {
  try {
    if (!isValidObjectId(req.params.userId)) {
      req.session.error = 'Recipient not found.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    const recipient = await User.findById(req.params.userId).lean();

    if (!recipient || recipient.accountStatus === 'suspended' || String(recipient._id) === String(req.session.user.id)) {
      req.session.error = 'Recipient not found or not available.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    const context = await resolveRelatedContext(req, req.session.user.id, recipient._id);

    if (!(await canMessageRecipient(req, recipient, context))) {
      req.session.error = 'You can only message users connected to a product enquiry or order.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    return res.render('messages/form', {
      title: `Message ${displayName(recipient)}`,
      recipient,
      formData: normalizeForm({}, { subject: context.subject }),
      errors: [],
      context
    });
  } catch (error) {
    return next(error);
  }
}

async function sendComposedMessage(req, res, next) {
  try {
    if (!isValidObjectId(req.params.userId)) {
      req.session.error = 'Recipient not found.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    const recipient = await User.findById(req.params.userId).lean();

    if (!recipient || recipient.accountStatus === 'suspended' || String(recipient._id) === String(req.session.user.id)) {
      req.session.error = 'Recipient not found or not available.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    const context = await resolveRelatedContext(req, req.session.user.id, recipient._id);

    if (!(await canMessageRecipient(req, recipient, context))) {
      req.session.error = 'You can only message users connected to a product enquiry or order.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    const result = validationResult(req);
    const formData = normalizeForm(req.body, { subject: context.subject });

    if (!result.isEmpty()) {
      return res.status(422).render('messages/form', {
        title: `Message ${displayName(recipient)}`,
        recipient,
        formData,
        errors: result.array(),
        context
      });
    }

    const message = await createUserMessage({
      senderId: req.session.user.id,
      recipientId: recipient._id,
      subject: formData.subject,
      body: formData.body,
      messageType: context.relatedOrder ? 'order_message' : context.relatedProduct ? 'product_enquiry' : 'general',
      relatedProduct: context.relatedProduct,
      relatedOrder: context.relatedOrder,
      productSnapshot: context.productSnapshot,
      orderSnapshot: context.orderSnapshot
    });

    await recordAuditLog(req, {
      action: 'message.sent',
      targetType: 'Message',
      target: message._id,
      targetLabel: message.subject,
      message: 'User sent a message through the message center.',
      metadata: { recipient: String(recipient._id), messageType: message.messageType }
    });

    req.session.success = 'Message sent successfully.';

    return res.redirect('/dashboard/messages/sent');
  } catch (error) {
    return next(error);
  }
}

async function replyForm(req, res, next) {
  try {
    const original = await findMessageForUser(req);

    if (!original) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/messages');
    }

    const currentId = String(req.session.user.id);
    const replyTo = String(original.sender?._id || original.sender) === currentId
      ? original.recipient
      : original.sender;

    if (!replyTo?._id) {
      req.session.error = 'Reply recipient could not be found.';
      return res.redirect('/dashboard/messages');
    }

    const context = {
      relatedProduct: original.relatedProduct?._id || original.relatedProduct || null,
      relatedOrder: original.relatedOrder?._id || original.relatedOrder || null,
      productSnapshot: original.productSnapshot || {},
      orderSnapshot: original.orderSnapshot || {},
      subject: original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`,
      parentMessage: original._id
    };

    return res.render('messages/form', {
      title: `Reply to ${displayName(replyTo)}`,
      recipient: replyTo,
      formData: normalizeForm({}, { subject: context.subject }),
      errors: [],
      context
    });
  } catch (error) {
    return next(error);
  }
}

async function sendReply(req, res, next) {
  try {
    const original = await findMessageForUser(req);

    if (!original) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/messages');
    }

    const currentId = String(req.session.user.id);
    const replyTo = String(original.sender?._id || original.sender) === currentId
      ? original.recipient
      : original.sender;

    if (!replyTo?._id) {
      req.session.error = 'Reply recipient could not be found.';
      return res.redirect('/dashboard/messages');
    }

    const context = {
      relatedProduct: original.relatedProduct?._id || original.relatedProduct || null,
      relatedOrder: original.relatedOrder?._id || original.relatedOrder || null,
      productSnapshot: original.productSnapshot || {},
      orderSnapshot: original.orderSnapshot || {},
      subject: original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`,
      parentMessage: original._id
    };

    const result = validationResult(req);
    const formData = normalizeForm(req.body, { subject: context.subject });

    if (!result.isEmpty()) {
      return res.status(422).render('messages/form', {
        title: `Reply to ${displayName(replyTo)}`,
        recipient: replyTo,
        formData,
        errors: result.array(),
        context
      });
    }

    const message = await createUserMessage({
      senderId: req.session.user.id,
      recipientId: replyTo._id,
      subject: formData.subject,
      body: formData.body,
      messageType: 'reply',
      relatedProduct: context.relatedProduct,
      relatedOrder: context.relatedOrder,
      parentMessage: context.parentMessage,
      productSnapshot: context.productSnapshot,
      orderSnapshot: context.orderSnapshot
    });

    await recordAuditLog(req, {
      action: 'message.replied',
      targetType: 'Message',
      target: message._id,
      targetLabel: message.subject,
      message: 'User replied to a message through the message center.',
      metadata: { recipient: String(replyTo._id), parentMessage: String(original._id) }
    });

    req.session.success = 'Reply sent successfully.';

    return res.redirect(`/dashboard/messages/${message._id}`);
  } catch (error) {
    return next(error);
  }
}

async function markRead(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/messages');
    }

    const message = await Message.findOneAndUpdate(
      { _id: req.params.id, recipient: req.session.user.id },
      { readAt: new Date() },
      { new: true }
    ).lean();

    if (!message) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/messages');
    }

    return res.redirect('/dashboard/messages');
  } catch (error) {
    return next(error);
  }
}

async function adminMessages(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    const filter = {};

    if (q) {
      const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { subject: pattern },
        { body: pattern },
        { 'senderSnapshot.name': pattern },
        { 'senderSnapshot.email': pattern },
        { 'senderSnapshot.farmName': pattern },
        { 'senderSnapshot.organization': pattern },
        { 'recipientSnapshot.name': pattern },
        { 'recipientSnapshot.email': pattern },
        { 'recipientSnapshot.farmName': pattern },
        { 'recipientSnapshot.organization': pattern },
        { 'productSnapshot.name': pattern },
        { 'orderSnapshot.reference': pattern }
      ];
    }

    const messages = await populateMessageQuery(Message.find(filter))
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.render('admin/messages', {
      title: 'Message records',
      messages,
      filters: { q },
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function adminMessagesPrint(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    const filter = {};

    if (q) {
      const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { subject: pattern },
        { body: pattern },
        { 'senderSnapshot.name': pattern },
        { 'senderSnapshot.email': pattern },
        { 'recipientSnapshot.name': pattern },
        { 'recipientSnapshot.email': pattern },
        { 'productSnapshot.name': pattern },
        { 'orderSnapshot.reference': pattern }
      ];
    }

    const messages = await populateMessageQuery(Message.find(filter))
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.render('admin/messages', {
      title: 'Print message records',
      messages,
      filters: { q },
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listInbox,
  listSent,
  showMessage,
  printMessage,
  composeForm,
  sendComposedMessage,
  replyForm,
  sendReply,
  markRead,
  adminMessages,
  adminMessagesPrint
};
