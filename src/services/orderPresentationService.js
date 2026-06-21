function getOrderDatePart(order) {
  const date = new Date(order?.createdAt || Date.now());

  if (Number.isNaN(date.getTime())) {
    return 'DATE';
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}${month}${day}`;
}

function getOrderReference(order) {
  const id = String(order?._id || '').slice(-6).toUpperCase() || 'ORDER';
  return `AGL-${getOrderDatePart(order)}-${id}`;
}

function getReceiptReference(order) {
  const id = String(order?._id || '').slice(-6).toUpperCase() || 'RECEIPT';
  const date = new Date(order?.receiptIssuedAt || order?.paymentConfirmedAt || order?.createdAt || Date.now());

  if (Number.isNaN(date.getTime())) {
    return `RCT-${id}`;
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `RCT-${year}${month}${day}-${id}`;
}

function getOrderCurrency(order) {
  return order?.productSnapshot?.currency || 'FJD';
}

function getOrderUnitPrice(order) {
  const number = Number(order?.productSnapshot?.price || 0);
  return Number.isFinite(number) ? number : 0;
}

function getOrderQuantity(order) {
  const number = Number(order?.requestedQuantity || 0);
  return Number.isFinite(number) ? number : 0;
}

function safeVatRate(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  if (number > 100) return 100;
  return number;
}

function getOrderVatMode(order) {
  return order?.productSnapshot?.vatMode || 'none';
}

function getOrderVatRate(order) {
  return safeVatRate(order?.productSnapshot?.vatRate);
}

function calculateOrderTotals({ unitPrice = 0, quantity = 0, vatMode = 'none', vatRate = 0 }) {
  const price = Number(unitPrice || 0);
  const qty = Number(quantity || 0);
  const rate = safeVatRate(vatRate);
  const base = Math.max(0, price) * Math.max(0, qty);

  if (!rate || vatMode === 'none') {
    return {
      subtotalExVat: roundMoney(base),
      vatAmount: 0,
      totalPrice: roundMoney(base)
    };
  }

  if (vatMode === 'inclusive') {
    const subtotalExVat = base / (1 + rate / 100);
    const vatAmount = base - subtotalExVat;
    return {
      subtotalExVat: roundMoney(subtotalExVat),
      vatAmount: roundMoney(vatAmount),
      totalPrice: roundMoney(base)
    };
  }

  const vatAmount = base * (rate / 100);
  return {
    subtotalExVat: roundMoney(base),
    vatAmount: roundMoney(vatAmount),
    totalPrice: roundMoney(base + vatAmount)
  };
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getOrderTotals(order) {
  if (order?.productSnapshot?.totalPrice) {
    return {
      subtotalExVat: Number(order.productSnapshot.subtotalExVat || 0),
      vatAmount: Number(order.productSnapshot.vatAmount || 0),
      totalPrice: Number(order.productSnapshot.totalPrice || 0)
    };
  }

  return calculateOrderTotals({
    unitPrice: getOrderUnitPrice(order),
    quantity: getOrderQuantity(order),
    vatMode: getOrderVatMode(order),
    vatRate: getOrderVatRate(order)
  });
}

function getOrderSubtotal(order) {
  return getOrderTotals(order).subtotalExVat;
}

function getOrderVatAmount(order) {
  return getOrderTotals(order).vatAmount;
}

function getOrderTotalPrice(order) {
  return getOrderTotals(order).totalPrice;
}

function getVatModeLabel(value) {
  const labels = {
    none: 'No VAT added',
    inclusive: 'VAT inclusive',
    exclusive: 'VAT exclusive'
  };

  return labels[value] || 'No VAT added';
}

function getOrderVatSummary(order) {
  const mode = getOrderVatMode(order);
  const rate = getOrderVatRate(order);

  if (!rate || mode === 'none') {
    return 'No VAT added';
  }

  return `${rate}% VAT ${mode === 'inclusive' ? 'inclusive' : 'exclusive'}`;
}

function getOrderProductName(order) {
  return order?.productSnapshot?.name || order?.product?.name || 'Produce request';
}

function getOrderBuyerName(order) {
  return order?.buyerSnapshot?.name || order?.buyer?.name || 'Buyer';
}

function getOrderFarmerName(order) {
  return order?.farmerSnapshot?.farmName || order?.farmerSnapshot?.name || order?.farmer?.name || 'Farmer';
}

function getPaymentMethodLabel(value) {
  const labels = {
    cash: 'Cash',
    mpaisa: 'M-PAiSA',
    mycash: 'MyCash',
    cheque: 'Cheque',
    direct_deposit: 'Direct deposit'
  };

  return labels[value] || 'Not recorded';
}

function getFarmerPaymentDetails(source) {
  const snapshot = source?.farmerPaymentSnapshot || {};
  const profile = source?.farmer?.farmerProfile || source?.farmerProfile || {};

  return {
    bankName: snapshot.bankName || profile.bankName || '',
    bankAccountNumber: snapshot.bankAccountNumber || profile.bankAccountNumber || '',
    mpaisaNumber: snapshot.mpaisaNumber || profile.mpaisaNumber || '',
    mycashNumber: snapshot.mycashNumber || profile.mycashNumber || ''
  };
}

function hasFarmerPaymentDetails(source) {
  const details = getFarmerPaymentDetails(source);
  return Boolean(
    details.bankName ||
    details.bankAccountNumber ||
    details.mpaisaNumber ||
    details.mycashNumber
  );
}

function getOrderFinancialNote(order) {
  if (order?.receiptStatus === 'cancelled') {
    return 'Receipt was cancelled by the farmer after order cancellation.';
  }

  if (order?.receiptIssuedAt && order?.paymentStatus === 'paid') {
    return 'Farmer-issued receipt for payment received.';
  }

  if (order?.status === 'completed') {
    return 'Completed order record. A formal receipt has not been issued yet.';
  }

  if (order?.status === 'accepted') {
    return 'Accepted order record. The farmer must confirm payment before issuing a receipt.';
  }

  return 'Order request record. This is not a receipt or proof of payment.';
}

module.exports = {
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
  getOrderFinancialNote,
  calculateOrderTotals
};
