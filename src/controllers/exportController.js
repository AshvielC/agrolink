const User = require('../models/User');
const { Product, PRODUCT_STATUSES, PRODUCT_CATEGORIES } = require('../models/Product');
const { OrderRequest, ORDER_STATUSES, PAYMENT_STATUSES } = require('../models/OrderRequest');
const Message = require('../models/Message');
const AuditLog = require('../models/AuditLog');
const { Report, REPORT_STATUSES, REPORT_REASONS, REPORT_TARGET_TYPES } = require('../models/Report');
const { recordAuditLog } = require('../services/auditService');
const {
  getOrderReference,
  getReceiptReference,
  getOrderSubtotal,
  getOrderVatAmount,
  getOrderTotalPrice,
  getOrderVatSummary,
  getPaymentMethodLabel
} = require('../services/orderPresentationService');

const DATASETS = ['users', 'products', 'orders', 'receipts', 'messages', 'reports', 'audit'];
const MAX_EXPORT_ROWS = 5000;

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regex(value) {
  return new RegExp(escapeRegex(value), 'i');
}

function parseDateStart(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDateRange(filter, field, filters) {
  const start = parseDateStart(filters.dateFrom);
  const end = parseDateEnd(filters.dateTo);

  if (!start && !end) return filter;

  filter[field] = filter[field] || {};
  if (start) filter[field].$gte = start;
  if (end) filter[field].$lte = end;
  return filter;
}

function normalizeDataset(value) {
  return DATASETS.includes(value) ? value : '';
}

function safeString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function formatMoney(value, currency = 'FJD') {
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function csvEscape(value) {
  let raw = safeString(value);

  // Prevent spreadsheet formula injection when admins open exports in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(raw)) {
    raw = `'${raw}`;
  }

  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}


function toCsv(columns, rows) {
  const header = columns.map((column) => csvEscape(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => csvEscape(column.value(row))).join(',')).join('\r\n');
  return `\uFEFF${header}${body ? `\r\n${body}` : ''}`;
}

function datasetLabel(dataset) {
  const labels = {
    users: 'Users',
    products: 'Products',
    orders: 'Orders',
    receipts: 'Receipts',
    messages: 'Messages',
    reports: 'Reports',
    audit: 'Audit logs'
  };
  return labels[dataset] || 'Export';
}

function commonFilters(query = {}) {
  return {
    q: String(query.q || '').trim(),
    status: String(query.status || '').trim(),
    role: String(query.role || '').trim(),
    documentStatus: String(query.documentStatus || '').trim(),
    category: String(query.category || '').trim(),
    location: String(query.location || '').trim(),
    paymentStatus: String(query.paymentStatus || '').trim(),
    reason: String(query.reason || '').trim(),
    targetType: String(query.targetType || '').trim(),
    messageType: String(query.messageType || '').trim(),
    actorRole: String(query.actorRole || '').trim(),
    severity: String(query.severity || '').trim(),
    dateFrom: String(query.dateFrom || '').trim(),
    dateTo: String(query.dateTo || '').trim()
  };
}

function userProfileName(user = {}) {
  if (user.role === 'farmer') return user.farmerProfile?.farmName || user.name || '';
  if (user.role === 'buyer') return user.buyerProfile?.organization || user.name || '';
  return user.name || '';
}

function userLocation(user = {}) {
  if (user.role === 'farmer') return user.farmerProfile?.farmLocation || user.farmerProfile?.farmAddress || '';
  if (user.role === 'buyer') return user.buyerProfile?.buyingLocation || user.buyerProfile?.deliveryAddress || '';
  return '';
}

function userAddress(user = {}) {
  if (user.role === 'farmer') return user.farmerProfile?.farmAddress || '';
  if (user.role === 'buyer') return user.buyerProfile?.deliveryAddress || '';
  return '';
}

function userFilter(filters) {
  const filter = {};
  if (['buyer', 'farmer', 'admin'].includes(filters.role)) filter.role = filters.role;
  if (['active', 'pending_approval', 'suspended'].includes(filters.status)) filter.accountStatus = filters.status;
  if (['pending', 'approved', 'rejected'].includes(filters.documentStatus)) filter.documentReviewStatus = filters.documentStatus;

  if (filters.q) {
    const q = regex(filters.q);
    filter.$or = [
      { name: q },
      { email: q },
      { phone: q },
      { 'farmerProfile.farmName': q },
      { 'farmerProfile.ownerName': q },
      { 'farmerProfile.farmLocation': q },
      { 'buyerProfile.organization': q },
      { 'buyerProfile.contactName': q },
      { 'buyerProfile.buyingLocation': q }
    ];
  }

  if (filters.location) {
    const q = regex(filters.location);
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { 'farmerProfile.farmLocation': q },
        { 'farmerProfile.farmAddress': q },
        { 'buyerProfile.buyingLocation': q },
        { 'buyerProfile.deliveryAddress': q }
      ]
    });
  }

  return addDateRange(filter, 'createdAt', filters);
}

async function productFilter(filters) {
  const filter = {};
  if (PRODUCT_STATUSES.includes(filters.status)) filter.status = filters.status;
  if (PRODUCT_CATEGORIES.includes(filters.category)) filter.category = filters.category;

  if (filters.location) filter.location = regex(filters.location);

  if (filters.q) {
    const q = regex(filters.q);
    const matchingFarmers = await User.find({
      role: 'farmer',
      $or: [
        { name: q },
        { email: q },
        { 'farmerProfile.farmName': q },
        { 'farmerProfile.ownerName': q },
        { 'farmerProfile.farmLocation': q }
      ]
    }).select('_id').limit(1000).lean();

    filter.$or = [
      { name: q },
      { category: q },
      { location: q },
      { description: q }
    ];

    if (matchingFarmers.length) {
      filter.$or.push({ farmer: { $in: matchingFarmers.map((farmer) => farmer._id) } });
    }
  }

  return addDateRange(filter, 'createdAt', filters);
}

function orderFilter(filters, receiptsOnly = false) {
  const filter = {};
  if (ORDER_STATUSES.includes(filters.status)) filter.status = filters.status;
  if (PAYMENT_STATUSES.includes(filters.paymentStatus)) filter.paymentStatus = filters.paymentStatus;

  if (receiptsOnly) {
    filter.receiptIssuedAt = { $ne: null };
    filter.paymentStatus = 'paid';
  }

  if (filters.q) {
    const q = regex(filters.q);
    filter.$or = [
      { buyerContactEmail: q },
      { buyerContactPhone: q },
      { 'buyerSnapshot.name': q },
      { 'buyerSnapshot.email': q },
      { 'farmerSnapshot.name': q },
      { 'farmerSnapshot.email': q },
      { 'farmerSnapshot.farmName': q },
      { 'productSnapshot.name': q },
      { 'productSnapshot.category': q },
      { 'productSnapshot.location': q },
      { paymentReference: q }
    ];
  }

  return addDateRange(filter, receiptsOnly ? 'receiptIssuedAt' : 'createdAt', filters);
}

function messageFilter(filters) {
  const filter = {};
  if (['general', 'product_enquiry', 'order_message', 'reply'].includes(filters.messageType)) filter.messageType = filters.messageType;

  if (filters.q) {
    const q = regex(filters.q);
    filter.$or = [
      { subject: q },
      { body: q },
      { 'senderSnapshot.name': q },
      { 'senderSnapshot.email': q },
      { 'senderSnapshot.farmName': q },
      { 'senderSnapshot.organization': q },
      { 'recipientSnapshot.name': q },
      { 'recipientSnapshot.email': q },
      { 'recipientSnapshot.farmName': q },
      { 'recipientSnapshot.organization': q },
      { 'productSnapshot.name': q },
      { 'orderSnapshot.reference': q }
    ];
  }

  return addDateRange(filter, 'createdAt', filters);
}

function reportFilter(filters) {
  const filter = {};
  if (REPORT_STATUSES.includes(filters.status)) filter.status = filters.status;
  if (REPORT_REASONS.includes(filters.reason)) filter.reason = filters.reason;
  if (REPORT_TARGET_TYPES.includes(filters.targetType)) filter.targetType = filters.targetType;

  if (filters.q) {
    const q = regex(filters.q);
    filter.$or = [
      { description: q },
      { adminNote: q },
      { resolutionNote: q },
      { 'reporterSnapshot.name': q },
      { 'reporterSnapshot.email': q },
      { 'reporterSnapshot.farmName': q },
      { 'reporterSnapshot.organization': q },
      { 'reportedUserSnapshot.name': q },
      { 'reportedUserSnapshot.email': q },
      { 'reportedUserSnapshot.farmName': q },
      { 'reportedUserSnapshot.organization': q },
      { 'targetSnapshot.title': q },
      { 'targetSnapshot.subtitle': q }
    ];
  }

  return addDateRange(filter, 'createdAt', filters);
}

function auditFilter(filters) {
  const filter = {};
  if (['buyer', 'farmer', 'admin', 'system'].includes(filters.actorRole)) filter.actorRole = filters.actorRole;
  if (['info', 'warning', 'critical'].includes(filters.severity)) filter.severity = filters.severity;

  if (filters.q) {
    const q = regex(filters.q);
    filter.$or = [
      { action: q },
      { actorName: q },
      { actorEmail: q },
      { targetLabel: q },
      { message: q },
      { category: q },
      { path: q },
      { requestId: q }
    ];
  }

  return addDateRange(filter, 'createdAt', filters);
}

const DATASET_COLUMNS = {
  users: [
    { key: 'createdAt', label: 'Joined', value: (u) => formatDateTime(u.createdAt) },
    { key: 'name', label: 'Name', value: (u) => u.name },
    { key: 'email', label: 'Email', value: (u) => u.email },
    { key: 'phone', label: 'Phone', value: (u) => u.phone || u.farmerProfile?.phone || u.buyerProfile?.phone || '' },
    { key: 'role', label: 'Role', value: (u) => u.role },
    { key: 'accountStatus', label: 'Account status', value: (u) => u.accountStatus || 'active' },
    { key: 'documentReviewStatus', label: 'Document status', value: (u) => u.documentReviewStatus || 'pending' },
    { key: 'profileName', label: 'Farm / Organization', value: userProfileName },
    { key: 'location', label: 'Location', value: userLocation },
    { key: 'address', label: 'Address', value: userAddress },
    { key: 'tinStatus', label: 'TIN status', value: (u) => u.verificationDocuments?.tinDocument?.status || 'pending' },
    { key: 'businessStatus', label: 'Business registration status', value: (u) => u.verificationDocuments?.businessRegistrationCertificate?.status || 'pending' }
  ],
  products: [
    { key: 'createdAt', label: 'Listed', value: (p) => formatDateTime(p.createdAt) },
    { key: 'name', label: 'Product', value: (p) => p.name },
    { key: 'category', label: 'Category', value: (p) => p.category },
    { key: 'farmer', label: 'Farmer / Farm', value: (p) => p.farmer?.farmerProfile?.farmName || p.farmer?.name || '' },
    { key: 'farmerEmail', label: 'Farmer email', value: (p) => p.farmer?.email || '' },
    { key: 'location', label: 'Location', value: (p) => p.location },
    { key: 'quantity', label: 'Quantity', value: (p) => `${p.quantity || 0} ${p.unit || ''}`.trim() },
    { key: 'price', label: 'Unit price', value: (p) => formatMoney(p.price, p.currency || 'FJD') },
    { key: 'vat', label: 'VAT', value: (p) => `${p.vatMode || 'none'} ${p.vatRate || 0}%` },
    { key: 'status', label: 'Status', value: (p) => p.status },
    { key: 'views', label: 'Views', value: (p) => p.analytics?.viewCount || 0 },
    { key: 'requests', label: 'Requests', value: (p) => p.analytics?.requestCount || 0 },
    { key: 'messages', label: 'Messages', value: (p) => p.analytics?.contactCount || 0 }
  ],
  orders: [
    { key: 'createdAt', label: 'Created', value: (o) => formatDateTime(o.createdAt) },
    { key: 'reference', label: 'Order reference', value: getOrderReference },
    { key: 'product', label: 'Product', value: (o) => o.productSnapshot?.name || '' },
    { key: 'buyer', label: 'Buyer', value: (o) => o.buyerSnapshot?.name || o.buyer?.name || '' },
    { key: 'buyerEmail', label: 'Buyer email', value: (o) => o.buyerContactEmail || o.buyerSnapshot?.email || '' },
    { key: 'farmer', label: 'Farmer / Farm', value: (o) => o.farmerSnapshot?.farmName || o.farmerSnapshot?.name || o.farmer?.name || '' },
    { key: 'quantity', label: 'Quantity', value: (o) => `${o.requestedQuantity || 0} ${o.unit || ''}`.trim() },
    { key: 'subtotal', label: 'Subtotal ex VAT', value: (o) => formatMoney(getOrderSubtotal(o), o.productSnapshot?.currency || 'FJD') },
    { key: 'vat', label: 'VAT amount', value: (o) => formatMoney(getOrderVatAmount(o), o.productSnapshot?.currency || 'FJD') },
    { key: 'total', label: 'Total', value: (o) => formatMoney(getOrderTotalPrice(o), o.productSnapshot?.currency || 'FJD') },
    { key: 'vatSummary', label: 'VAT status', value: getOrderVatSummary },
    { key: 'status', label: 'Order status', value: (o) => o.status },
    { key: 'paymentStatus', label: 'Payment status', value: (o) => o.paymentStatus },
    { key: 'paymentMethod', label: 'Payment method', value: (o) => getPaymentMethodLabel(o.paymentMethod) },
    { key: 'fulfillmentStatus', label: 'Pickup/delivery status', value: (o) => o.fulfillment?.status || 'not_scheduled' },
    { key: 'fulfillmentMethod', label: 'Pickup/delivery method', value: (o) => o.fulfillment?.method || '' },
    { key: 'fulfillmentDate', label: 'Pickup/delivery date', value: (o) => formatDateTime(o.fulfillment?.requestedDate).slice(0, 10) },
    { key: 'fulfillmentLocation', label: 'Pickup/delivery location', value: (o) => o.fulfillment?.location || '' }
  ],
  receipts: [
    { key: 'receiptIssuedAt', label: 'Receipt issued', value: (o) => formatDateTime(o.receiptIssuedAt) },
    { key: 'receiptNumber', label: 'Receipt number', value: getReceiptReference },
    { key: 'orderReference', label: 'Order reference', value: getOrderReference },
    { key: 'product', label: 'Product', value: (o) => o.productSnapshot?.name || '' },
    { key: 'buyer', label: 'Buyer', value: (o) => o.buyerSnapshot?.name || o.buyer?.name || '' },
    { key: 'farmer', label: 'Farmer / Farm', value: (o) => o.farmerSnapshot?.farmName || o.farmerSnapshot?.name || o.farmer?.name || '' },
    { key: 'quantity', label: 'Quantity', value: (o) => `${o.requestedQuantity || 0} ${o.unit || ''}`.trim() },
    { key: 'total', label: 'Total', value: (o) => formatMoney(getOrderTotalPrice(o), o.productSnapshot?.currency || 'FJD') },
    { key: 'amountPaid', label: 'Amount paid', value: (o) => formatMoney(o.amountPaid, o.productSnapshot?.currency || 'FJD') },
    { key: 'paymentMethod', label: 'Payment method', value: (o) => getPaymentMethodLabel(o.paymentMethod) },
    { key: 'paymentReference', label: 'Payment reference', value: (o) => o.paymentReference || '' },
    { key: 'vatSummary', label: 'VAT status', value: getOrderVatSummary }
  ],
  messages: [
    { key: 'createdAt', label: 'Sent', value: (m) => formatDateTime(m.createdAt) },
    { key: 'subject', label: 'Subject', value: (m) => m.subject },
    { key: 'sender', label: 'Sender', value: (m) => m.senderSnapshot?.farmName || m.senderSnapshot?.organization || m.senderSnapshot?.name || '' },
    { key: 'senderEmail', label: 'Sender email', value: (m) => m.senderSnapshot?.email || '' },
    { key: 'recipient', label: 'Recipient', value: (m) => m.recipientSnapshot?.farmName || m.recipientSnapshot?.organization || m.recipientSnapshot?.name || '' },
    { key: 'recipientEmail', label: 'Recipient email', value: (m) => m.recipientSnapshot?.email || '' },
    { key: 'type', label: 'Type', value: (m) => m.messageType },
    { key: 'product', label: 'Product', value: (m) => m.productSnapshot?.name || '' },
    { key: 'order', label: 'Order', value: (m) => m.orderSnapshot?.reference || '' },
    { key: 'body', label: 'Message', value: (m) => m.body }
  ],
  reports: [
    { key: 'createdAt', label: 'Created', value: (r) => formatDateTime(r.createdAt) },
    { key: 'status', label: 'Status', value: (r) => r.status },
    { key: 'reason', label: 'Reason', value: (r) => r.reason },
    { key: 'targetType', label: 'Target type', value: (r) => r.targetType },
    { key: 'target', label: 'Target', value: (r) => r.targetSnapshot?.title || '' },
    { key: 'reporter', label: 'Reporter', value: (r) => r.reporterSnapshot?.farmName || r.reporterSnapshot?.organization || r.reporterSnapshot?.name || '' },
    { key: 'reporterEmail', label: 'Reporter email', value: (r) => r.reporterSnapshot?.email || '' },
    { key: 'reportedUser', label: 'Reported user', value: (r) => r.reportedUserSnapshot?.farmName || r.reportedUserSnapshot?.organization || r.reportedUserSnapshot?.name || '' },
    { key: 'adminAction', label: 'Admin action', value: (r) => r.adminAction || 'none' },
    { key: 'description', label: 'Description', value: (r) => r.description }
  ],
  audit: [
    { key: 'createdAt', label: 'Date/time', value: (a) => formatDateTime(a.createdAt) },
    { key: 'action', label: 'Action', value: (a) => a.action },
    { key: 'actor', label: 'Actor', value: (a) => a.actorName || 'System' },
    { key: 'actorEmail', label: 'Actor email', value: (a) => a.actorEmail || '' },
    { key: 'actorRole', label: 'Actor role', value: (a) => a.actorRole || '' },
    { key: 'target', label: 'Target', value: (a) => a.targetLabel || '' },
    { key: 'category', label: 'Category', value: (a) => a.category || '' },
    { key: 'severity', label: 'Severity', value: (a) => a.severity || '' },
    { key: 'ip', label: 'IP address', value: (a) => a.ipAddress || '' },
    { key: 'requestPath', label: 'Request path', value: (a) => a.path || '' },
    { key: 'requestId', label: 'Request ID', value: (a) => a.requestId || '' },
    { key: 'message', label: 'Message', value: (a) => a.message || '' }
  ]
};

async function fetchRows(dataset, filters) {
  if (dataset === 'users') {
    return User.find(userFilter(filters)).sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean();
  }

  if (dataset === 'products') {
    return Product.find(await productFilter(filters))
      .populate('farmer', 'name email farmerProfile accountStatus')
      .sort({ createdAt: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean();
  }

  if (dataset === 'orders' || dataset === 'receipts') {
    return OrderRequest.find(orderFilter(filters, dataset === 'receipts'))
      .populate('buyer', 'name email buyerProfile')
      .populate('farmer', 'name email farmerProfile')
      .populate('product', 'name status')
      .sort(dataset === 'receipts' ? { receiptIssuedAt: -1 } : { createdAt: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean();
  }

  if (dataset === 'messages') {
    return Message.find(messageFilter(filters)).sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean();
  }

  if (dataset === 'reports') {
    return Report.find(reportFilter(filters)).sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean();
  }

  if (dataset === 'audit') {
    return AuditLog.find(auditFilter(filters)).sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean();
  }

  return [];
}

function exportCards() {
  return [
    {
      dataset: 'users',
      title: 'Users',
      description: 'Export buyers, farmers, admins, document statuses, phone numbers, locations, and approval state.',
      fields: ['q', 'role', 'status', 'documentStatus', 'location', 'dateFrom', 'dateTo']
    },
    {
      dataset: 'products',
      title: 'Products',
      description: 'Export product listings, farmer/farm details, VAT settings, prices, quantities, and activity counts.',
      fields: ['q', 'status', 'category', 'location', 'dateFrom', 'dateTo']
    },
    {
      dataset: 'orders',
      title: 'Orders',
      description: 'Export order requests by status, buyer, farmer, farm name, product, payment state, and date.',
      fields: ['q', 'status', 'paymentStatus', 'dateFrom', 'dateTo']
    },
    {
      dataset: 'receipts',
      title: 'Receipts',
      description: 'Export farmer-issued paid receipts with payment method, amount paid, VAT, and totals.',
      fields: ['q', 'dateFrom', 'dateTo']
    },
    {
      dataset: 'messages',
      title: 'Messages',
      description: 'Export in-app communication records by user, subject, product, and order reference.',
      fields: ['q', 'messageType', 'dateFrom', 'dateTo']
    },
    {
      dataset: 'reports',
      title: 'Reports',
      description: 'Export complaint/dispute records by status, reason, target type, user, and date.',
      fields: ['q', 'status', 'reason', 'targetType', 'dateFrom', 'dateTo']
    },
    {
      dataset: 'audit',
      title: 'Audit logs',
      description: 'Export activity logs by action, actor, role, severity, request ID, and date.',
      fields: ['q', 'actorRole', 'severity', 'dateFrom', 'dateTo']
    }
  ];
}

async function index(req, res, next) {
  try {
    return res.render('admin/exports', {
      title: 'Export center',
      cards: exportCards(),
      roles: ['buyer', 'farmer', 'admin'],
      accountStatuses: ['active', 'pending_approval', 'suspended'],
      documentStatuses: ['pending', 'approved', 'rejected'],
      productStatuses: PRODUCT_STATUSES,
      productCategories: PRODUCT_CATEGORIES,
      orderStatuses: ORDER_STATUSES,
      paymentStatuses: PAYMENT_STATUSES,
      reportStatuses: REPORT_STATUSES,
      reportReasons: REPORT_REASONS,
      reportTargetTypes: REPORT_TARGET_TYPES,
      messageTypes: ['general', 'product_enquiry', 'order_message', 'reply'],
      actorRoles: ['buyer', 'farmer', 'admin', 'system'],
      severities: ['info', 'warning', 'critical']
    });
  } catch (error) {
    return next(error);
  }
}

async function csv(req, res, next) {
  try {
    const dataset = normalizeDataset(req.params.dataset);
    if (!dataset) {
      req.session.error = 'Export type not found.';
      return res.redirect('/dashboard/admin/exports');
    }

    const filters = commonFilters(req.query);
    const rows = await fetchRows(dataset, filters);
    const columns = DATASET_COLUMNS[dataset];
    const csvBody = toCsv(columns, rows);
    const filenameDate = new Date().toISOString().slice(0, 10);

    await recordAuditLog(req, {
      action: 'admin.export_csv',
      targetType: 'System',
      targetLabel: `${datasetLabel(dataset)} CSV export`,
      category: 'export',
      severity: 'info',
      message: `Admin exported ${rows.length} ${datasetLabel(dataset).toLowerCase()} rows as CSV.`,
      metadata: { dataset, filters, rowCount: rows.length }
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="agrolink-${dataset}-${filenameDate}.csv"`);
    return res.send(csvBody);
  } catch (error) {
    return next(error);
  }
}

async function printView(req, res, next) {
  try {
    const dataset = normalizeDataset(req.params.dataset);
    if (!dataset) {
      req.session.error = 'Export type not found.';
      return res.redirect('/dashboard/admin/exports');
    }

    const filters = commonFilters(req.query);
    const rows = await fetchRows(dataset, filters);
    const columns = DATASET_COLUMNS[dataset];

    await recordAuditLog(req, {
      action: 'admin.export_print_viewed',
      targetType: 'System',
      targetLabel: `${datasetLabel(dataset)} print export`,
      category: 'export',
      severity: 'info',
      message: `Admin opened printable export for ${rows.length} ${datasetLabel(dataset).toLowerCase()} rows.`,
      metadata: { dataset, filters, rowCount: rows.length }
    });

    return res.render('admin/export-print', {
      title: `${datasetLabel(dataset)} export`,
      dataset,
      datasetLabel: datasetLabel(dataset),
      rows,
      columns,
      filters,
      generatedAt: new Date(),
      maxRows: MAX_EXPORT_ROWS
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  index,
  csv,
  printView
};
