const mongoose = require('mongoose');

const ORDER_STATUSES = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'];
const CLOSED_ORDER_STATUSES = ['rejected', 'completed', 'cancelled'];
const ACTIVE_ORDER_STATUSES = ['pending', 'accepted'];
const PAYMENT_METHODS = ['cash', 'mpaisa', 'mycash', 'cheque', 'direct_deposit'];
const PAYMENT_STATUSES = ['unpaid', 'paid'];
const RECEIPT_STATUSES = ['not_issued', 'issued', 'cancelled'];
const FULFILLMENT_METHODS = ['pickup', 'delivery'];
const FULFILLMENT_STATUSES = ['not_scheduled', 'requested', 'reschedule_requested', 'confirmed', 'completed', 'cancelled'];

const orderRequestSchema = new mongoose.Schema(
  {
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },
    requestedQuantity: {
      type: Number,
      required: true,
      min: 0.01,
      max: 100000000
    },
    unit: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30
    },
    buyerContactEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address.']
    },
    buyerContactPhone: {
      type: String,
      trim: true,
      maxlength: 40,
      default: ''
    },
    deliveryNote: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ''
    },
    message: {
      type: String,
      trim: true,
      maxlength: 800,
      default: ''
    },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: 'pending',
      index: true
    },
    farmerResponse: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: 'unpaid',
      index: true
    },
    paymentMethod: {
      type: String,
      enum: [...PAYMENT_METHODS, ''],
      default: ''
    },
    amountPaid: {
      type: Number,
      min: 0,
      max: 100000000,
      default: 0
    },
    paymentReference: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ''
    },
    paymentConfirmedAt: {
      type: Date,
      default: null
    },
    receiptStatus: {
      type: String,
      enum: RECEIPT_STATUSES,
      default: 'not_issued',
      index: true
    },
    receiptIssuedAt: {
      type: Date,
      default: null,
      index: true
    },
    receiptIssuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    receiptNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    receiptCancelledAt: {
      type: Date,
      default: null,
      index: true
    },
    receiptCancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    receiptCancellationReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    farmerPaymentSnapshot: {
      bankName: { type: String, trim: true, maxlength: 120, default: '' },
      bankAccountNumber: { type: String, trim: true, maxlength: 80, default: '' },
      mpaisaNumber: { type: String, trim: true, maxlength: 40, default: '' },
      mycashNumber: { type: String, trim: true, maxlength: 40, default: '' }
    },

    fulfillment: {
      method: { type: String, enum: [...FULFILLMENT_METHODS, ''], default: '' },
      status: { type: String, enum: FULFILLMENT_STATUSES, default: 'not_scheduled', index: true },
      requestedDate: { type: Date, default: null },
      requestedTime: { type: String, trim: true, maxlength: 80, default: '' },
      location: { type: String, trim: true, maxlength: 220, default: '' },
      note: { type: String, trim: true, maxlength: 500, default: '' },
      farmerProposedDate: { type: Date, default: null },
      farmerProposedTime: { type: String, trim: true, maxlength: 80, default: '' },
      farmerProposedLocation: { type: String, trim: true, maxlength: 220, default: '' },
      farmerNote: { type: String, trim: true, maxlength: 500, default: '' },
      confirmedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      cancelledAt: { type: Date, default: null },
      updatedByRole: { type: String, enum: ['buyer', 'farmer', 'system', ''], default: '' }
    },
    inventoryDeducted: {
      type: Boolean,
      default: false,
      index: true
    },
    inventoryDeductedAt: {
      type: Date,
      default: null
    },
    inventoryRestoredAt: {
      type: Date,
      default: null
    },
    respondedAt: {
      type: Date,
      default: null
    },
    cancelledAt: {
      type: Date,
      default: null
    },
    cancelledByRole: {
      type: String,
      enum: ['buyer', 'farmer', ''],
      default: ''
    },
    history: [
      {
        action: { type: String, trim: true, maxlength: 80, required: true },
        actorRole: { type: String, enum: ['buyer', 'farmer', 'system'], default: 'system' },
        note: { type: String, trim: true, maxlength: 500, default: '' },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    productSnapshot: {
      name: { type: String, trim: true, maxlength: 90, default: '' },
      category: { type: String, trim: true, maxlength: 60, default: '' },
      price: { type: Number, min: 0, default: 0 },
      currency: { type: String, trim: true, maxlength: 10, default: 'FJD' },
      vatMode: { type: String, enum: ['none', 'inclusive', 'exclusive', ''], default: 'none' },
      vatRate: { type: Number, min: 0, max: 100, default: 0 },
      subtotalExVat: { type: Number, min: 0, default: 0 },
      vatAmount: { type: Number, min: 0, default: 0 },
      totalPrice: { type: Number, min: 0, default: 0 },
      location: { type: String, trim: true, maxlength: 120, default: '' },
      imagePath: { type: String, trim: true, maxlength: 500, default: '' },
      quantityAvailableAtRequest: { type: Number, min: 0, default: 0 }
    },
    buyerSnapshot: {
      name: { type: String, trim: true, maxlength: 80, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' }
    },
    farmerSnapshot: {
      name: { type: String, trim: true, maxlength: 80, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
      farmName: { type: String, trim: true, maxlength: 120, default: '' }
    }
  },
  {
    timestamps: true
  }
);

orderRequestSchema.index({ farmer: 1, status: 1, createdAt: -1 });
orderRequestSchema.index({ buyer: 1, status: 1, createdAt: -1 });
orderRequestSchema.index({ product: 1, buyer: 1, createdAt: -1 });

module.exports = {
  OrderRequest: mongoose.model('OrderRequest', orderRequestSchema),
  ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  RECEIPT_STATUSES,
  FULFILLMENT_METHODS,
  FULFILLMENT_STATUSES
};
