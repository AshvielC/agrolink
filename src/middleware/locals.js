const config = require('../config/env');
const {
  getOrderReference,
  getReceiptReference,
  getOrderCurrency,
  getOrderUnitPrice,
  getOrderSubtotal,
  getOrderVatMode,
  getOrderVatRate,
  getOrderVatAmount,
  getOrderTotalPrice,
  getOrderProductName,
  getOrderBuyerName,
  getOrderFarmerName,
  getPaymentMethodLabel,
  getVatModeLabel,
  getOrderVatSummary,
  getFarmerPaymentDetails,
  hasFarmerPaymentDetails,
  getOrderFinancialNote
} = require('../services/orderPresentationService');

function formatDate(value) {
  if (!value) return 'Not set';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';

  return new Intl.DateTimeFormat('en-FJ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}


function formatDateTime(value) {
  if (!value) return 'Not set';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';

  return new Intl.DateTimeFormat('en-FJ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatMoney(value, currency = 'FJD') {
  const number = Number(value || 0);

  return new Intl.NumberFormat('en-FJ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(number);
}

function formatStatus(value) {
  if (!value) return '';

  const labels = {
    unavailable: 'Not available',
    pending_approval: 'Pending approval',
    active: 'Active',
    suspended: 'Suspended',
    skipped: 'Skipped',
    failed: 'Failed',
    sent: 'Sent',
    approved: 'Approved',
    rejected: 'Rejected',
    pending: 'Pending',
    admin: 'Admin',
    farmer: 'Farmer',
    buyer: 'Buyer',
    general: 'General',
    product_enquiry: 'Product enquiry',
    order_message: 'Order message',
    reply: 'Reply',
    open: 'Open',
    under_review: 'Under review',
    resolved: 'Resolved',
    fake_listing: 'Fake product listing',
    wrong_product_information: 'Wrong product information',
    payment_issue: 'Payment issue',
    order_not_fulfilled: 'Order not fulfilled',
    buyer_did_not_pay: 'Buyer did not pay',
    farmer_did_not_deliver: 'Farmer did not deliver',
    abusive_message: 'Abusive message',
    suspicious_account: 'Suspicious account',
    other: 'Other',
    product: 'Product',
    order: 'Order',
    message: 'Message',
    user: 'User',
    unread: 'Unread',
    read: 'Read',
    pickup: 'Pickup',
    delivery: 'Delivery',
    not_scheduled: 'Not scheduled',
    reschedule_requested: 'Change requested',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    listing_created: 'Listing created',
    manual_adjustment: 'Manual adjustment',
    reserved_for_order: 'Reserved for order',
    restored_from_cancellation: 'Restored from cancellation',
    order_completed: 'Order completed',
    order_cancelled_after_receipt: 'Order cancelled after receipt',
    listing_removed: 'Listing removed',
    not_issued: 'Not issued',
    issued: 'Issued'
  };

  return labels[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

function attachLocals(req, res, next) {
  res.locals.appName = config.appName;
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.session.success || null;
  res.locals.error = req.session.error || null;
  res.locals.formatDate = formatDate;
  res.locals.formatDateTime = formatDateTime;
  res.locals.formatMoney = formatMoney;
  res.locals.formatStatus = formatStatus;
  res.locals.orderReference = getOrderReference;
  res.locals.receiptReference = getReceiptReference;
  res.locals.orderCurrency = getOrderCurrency;
  res.locals.orderUnitPrice = getOrderUnitPrice;
  res.locals.orderSubtotal = getOrderSubtotal;
  res.locals.orderVatMode = getOrderVatMode;
  res.locals.orderVatRate = getOrderVatRate;
  res.locals.orderVatAmount = getOrderVatAmount;
  res.locals.orderTotalPrice = getOrderTotalPrice;
  res.locals.orderProductName = getOrderProductName;
  res.locals.orderBuyerName = getOrderBuyerName;
  res.locals.orderFarmerName = getOrderFarmerName;
  res.locals.paymentMethodLabel = getPaymentMethodLabel;
  res.locals.vatModeLabel = getVatModeLabel;
  res.locals.orderVatSummary = getOrderVatSummary;
  res.locals.farmerPaymentDetails = getFarmerPaymentDetails;
  res.locals.hasFarmerPaymentDetails = hasFarmerPaymentDetails;
  res.locals.orderFinancialNote = getOrderFinancialNote;
  res.locals.demoMode = config.demo.enabled;
  res.locals.demoNotice = config.demo.notice;

  delete req.session.success;
  delete req.session.error;

  next();
}

module.exports = {
  attachLocals
};
