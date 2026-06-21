const PDFDocument = require('pdfkit');
const config = require('../config/env');
const {
  getOrderReference,
  getReceiptReference,
  getOrderCurrency,
  getOrderUnitPrice,
  getOrderSubtotal,
  getOrderVatAmount,
  getOrderTotalPrice,
  getOrderProductName,
  getOrderBuyerName,
  getOrderFarmerName,
  getPaymentMethodLabel,
  getOrderVatSummary,
  getFarmerPaymentDetails
} = require('./orderPresentationService');

const STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  completed: 'Completed',
  cancelled: 'Cancelled',
  unpaid: 'Unpaid',
  paid: 'Paid',
  not_issued: 'Not issued',
  issued: 'Issued',
  pickup: 'Pickup',
  delivery: 'Delivery',
  not_scheduled: 'Not scheduled',
  requested: 'Requested',
  reschedule_requested: 'Change requested',
  confirmed: 'Confirmed',
  buyer: 'Buyer',
  farmer: 'Farmer',
  system: 'System'
};

function safeText(value, fallback = 'Not recorded') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function formatStatus(value) {
  if (!value) return 'Not recorded';
  return STATUS_LABELS[value] || String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
  return new Intl.NumberFormat('en-FJ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function sanitizeFilenamePart(value) {
  return String(value || 'order')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'order';
}

function getOrderPdfFilename(order) {
  return `${sanitizeFilenamePart(getOrderReference(order))}.pdf`;
}

function drawHorizontalRule(doc) {
  const y = doc.y + 6;
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor('#d9e2d0')
    .lineWidth(1)
    .stroke();
  doc.moveDown(1.2);
}

function ensureSpace(doc, requiredHeight = 120) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + requiredHeight > bottom) {
    doc.addPage();
  }
}

function writeSectionTitle(doc, title) {
  ensureSpace(doc, 70);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#214d22')
    .text(title);
  doc.moveDown(0.25);
}

function writeKeyValue(doc, label, value, options = {}) {
  const startX = doc.page.margins.left;
  const labelWidth = options.labelWidth || 140;
  const valueWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right - labelWidth;
  const y = doc.y;

  doc.font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#4f5b45')
    .text(label, startX, y, { width: labelWidth });

  doc.font('Helvetica')
    .fontSize(9)
    .fillColor('#1f2933')
    .text(safeText(value), startX + labelWidth, y, { width: valueWidth });

  doc.moveDown(0.65);
}

function writeTwoColumnRows(doc, leftRows, rightRows) {
  ensureSpace(doc, 130);
  const marginLeft = doc.page.margins.left;
  const gap = 24;
  const columnWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right - gap) / 2;
  const startY = doc.y;

  function writeColumn(rows, x) {
    doc.y = startY;
    rows.forEach(([label, value]) => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#4f5b45').text(label, x, y, { width: columnWidth });
      doc.font('Helvetica').fontSize(9.5).fillColor('#1f2933').text(safeText(value), x, y + 12, { width: columnWidth });
      doc.moveDown(1.05);
    });
    return doc.y;
  }

  const leftEnd = writeColumn(leftRows, marginLeft);
  const rightEnd = writeColumn(rightRows, marginLeft + columnWidth + gap);
  doc.y = Math.max(leftEnd, rightEnd) + 2;
}

function writeWrappedNote(doc, label, text) {
  if (!text) return;
  ensureSpace(doc, 70);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#4f5b45').text(label);
  doc.font('Helvetica').fontSize(9).fillColor('#1f2933').text(String(text), {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: 'left'
  });
  doc.moveDown(0.6);
}

function buildOrderPdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: `Order ${getOrderReference(order)}`,
        Author: config.appName,
        Subject: 'Order detail PDF'
      }
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const currency = getOrderCurrency(order);
    const fulfillment = order.fulfillment || {};
    const paymentDetails = getFarmerPaymentDetails(order);
    const receiptReference = order.receiptIssuedAt ? getReceiptReference(order) : 'Not issued';
    const cancellationStatus = order.status === 'cancelled'
      ? `Cancelled by ${formatStatus(order.cancelledByRole)} on ${formatDateTime(order.cancelledAt)}`
      : 'Not cancelled';

    doc.rect(0, 0, doc.page.width, 92).fill('#f0f7e8');
    doc.fillColor('#214d22')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(config.appName, 48, 30, { width: 300 });
    doc.font('Helvetica')
      .fontSize(10)
      .fillColor('#42503b')
      .text('Order PDF document', 48, 56);

    doc.font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#214d22')
      .text(getOrderReference(order), 320, 30, { width: 225, align: 'right' });
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor('#42503b')
      .text(`Generated ${formatDateTime(new Date())}`, 320, 50, { width: 225, align: 'right' });

    doc.y = 118;
    doc.font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#1f2933')
      .text('Order details');
    doc.font('Helvetica')
      .fontSize(10)
      .fillColor('#4f5b45')
      .text('This PDF was generated from the order record stored in the marketplace system.');
    drawHorizontalRule(doc);

    writeSectionTitle(doc, 'Order summary');
    writeTwoColumnRows(doc,
      [
        ['Order / request number', getOrderReference(order)],
        ['Requested date', formatDateTime(order.createdAt)],
        ['Order status', formatStatus(order.status)],
        ['Cancellation status', cancellationStatus]
      ],
      [
        ['Payment status', formatStatus(order.paymentStatus || 'unpaid')],
        ['Receipt reference', receiptReference],
        ['Receipt status', formatStatus(order.receiptStatus || 'not_issued')],
        ['Generated date', formatDateTime(new Date())]
      ]
    );

    writeSectionTitle(doc, 'Produce details');
    writeTwoColumnRows(doc,
      [
        ['Produce', getOrderProductName(order)],
        ['Category', order.productSnapshot?.category || 'Not recorded'],
        ['Quantity', `${order.requestedQuantity || 0} ${order.unit || ''}`.trim()],
        ['Product location', order.productSnapshot?.location || 'Not recorded']
      ],
      [
        ['Unit price', formatMoney(getOrderUnitPrice(order), currency)],
        ['Subtotal', formatMoney(getOrderSubtotal(order), currency)],
        ['VAT', `${getOrderVatSummary(order)} · ${formatMoney(getOrderVatAmount(order), currency)}`],
        ['Total price', formatMoney(getOrderTotalPrice(order), currency)]
      ]
    );

    writeSectionTitle(doc, 'Buyer and farmer details');
    writeTwoColumnRows(doc,
      [
        ['Buyer', getOrderBuyerName(order)],
        ['Buyer email', order.buyerContactEmail || order.buyerSnapshot?.email || order.buyer?.email || 'Not recorded'],
        ['Buyer phone', order.buyerContactPhone || 'Not recorded']
      ],
      [
        ['Farmer / farm', getOrderFarmerName(order)],
        ['Farmer email', order.farmerSnapshot?.email || order.farmer?.email || 'Not recorded'],
        ['Farm location', order.productSnapshot?.location || 'Not recorded']
      ]
    );

    writeSectionTitle(doc, 'Pickup / delivery schedule');
    writeTwoColumnRows(doc,
      [
        ['Schedule status', formatStatus(fulfillment.status || 'not_scheduled')],
        ['Method', fulfillment.method ? formatStatus(fulfillment.method) : 'Not set'],
        ['Date', formatDate(fulfillment.requestedDate)],
        ['Time', fulfillment.requestedTime || 'Not set']
      ],
      [
        ['Location / address', fulfillment.location || 'Not set'],
        ['Last updated by', fulfillment.updatedByRole ? formatStatus(fulfillment.updatedByRole) : 'Not set'],
        ['Confirmed', formatDateTime(fulfillment.confirmedAt)],
        ['Completed', formatDateTime(fulfillment.completedAt)]
      ]
    );
    writeWrappedNote(doc, 'Buyer schedule note', fulfillment.note);
    writeWrappedNote(doc, 'Farmer schedule note', fulfillment.farmerNote);

    writeSectionTitle(doc, 'Payment details');
    writeTwoColumnRows(doc,
      [
        ['Payment method', getPaymentMethodLabel(order.paymentMethod)],
        ['Amount paid', order.paymentStatus === 'paid' ? formatMoney(order.amountPaid || getOrderTotalPrice(order), currency) : 'Not paid yet'],
        ['Payment reference', order.paymentReference || 'Not recorded'],
        ['Payment confirmed', formatDateTime(order.paymentConfirmedAt)]
      ],
      [
        ['Bank name', paymentDetails.bankName || 'Not recorded'],
        ['Bank account', paymentDetails.bankAccountNumber || 'Not recorded'],
        ['M-PAiSA', paymentDetails.mpaisaNumber || 'Not recorded'],
        ['MyCash', paymentDetails.mycashNumber || 'Not recorded']
      ]
    );

    if (order.receiptStatus === 'cancelled') {
      writeSectionTitle(doc, 'Receipt cancellation');
      writeKeyValue(doc, 'Cancelled date', formatDateTime(order.receiptCancelledAt));
      writeKeyValue(doc, 'Reason', order.receiptCancellationReason || 'Not recorded');
    }

    if (order.deliveryNote || order.message || order.farmerResponse || order.receiptNote) {
      writeSectionTitle(doc, 'Notes');
      writeWrappedNote(doc, 'Original pickup/delivery note', order.deliveryNote);
      writeWrappedNote(doc, 'Buyer message', order.message);
      writeWrappedNote(doc, 'Farmer response', order.farmerResponse);
      writeWrappedNote(doc, 'Receipt note', order.receiptNote);
    }

    if (Array.isArray(order.history) && order.history.length) {
      writeSectionTitle(doc, 'Activity history');
      order.history.forEach((event) => {
        ensureSpace(doc, 50);
        doc.font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#1f2933')
          .text(safeText(event.action, 'Activity'));
        doc.font('Helvetica')
          .fontSize(8.5)
          .fillColor('#4f5b45')
          .text(`${formatStatus(event.actorRole)} · ${formatDateTime(event.createdAt)}`);
        if (event.note) {
          doc.font('Helvetica')
            .fontSize(8.5)
            .fillColor('#1f2933')
            .text(String(event.note), { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
        }
        doc.moveDown(0.5);
      });
    }

    ensureSpace(doc, 50);
    drawHorizontalRule(doc);
    doc.font('Helvetica')
      .fontSize(8)
      .fillColor('#4f5b45')
      .text(`${config.appName} · Generated order PDF · ${getOrderReference(order)}`, {
        align: 'center'
      });

    doc.end();
  });
}

module.exports = {
  buildOrderPdf,
  getOrderPdfFilename
};
