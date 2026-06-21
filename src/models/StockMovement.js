const mongoose = require('mongoose');

const STOCK_MOVEMENT_TYPES = [
  'listing_created',
  'manual_adjustment',
  'reserved_for_order',
  'restored_from_cancellation',
  'order_completed',
  'order_cancelled_after_receipt',
  'listing_removed'
];

const stockMovementSchema = new mongoose.Schema(
  {
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
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderRequest',
      default: null,
      index: true
    },
    movementType: {
      type: String,
      enum: STOCK_MOVEMENT_TYPES,
      required: true,
      index: true
    },
    quantityChange: {
      type: Number,
      required: true
    },
    quantityAfter: {
      type: Number,
      required: true,
      min: 0
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 30,
      default: ''
    },
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    actorRole: {
      type: String,
      enum: ['farmer', 'buyer', 'admin', 'system'],
      default: 'system'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

stockMovementSchema.index({ farmer: 1, product: 1, createdAt: -1 });
stockMovementSchema.index({ product: 1, createdAt: -1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
module.exports.STOCK_MOVEMENT_TYPES = STOCK_MOVEMENT_TYPES;
