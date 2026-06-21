const mongoose = require('mongoose');
const {
  ALLOWED_PRODUCT_IMAGE_MIME_TYPES,
  MAX_PRODUCT_IMAGE_SIZE_BYTES
} = require('../config/productLimits');

const CATEGORIES = [
  'Vegetables',
  'Fruits',
  'Root crops',
  'Grains',
  'Herbs',
  'Dairy',
  'Livestock',
  'Other'
];

const UNITS = ['kg', 'tonne', 'bundle', 'crate', 'bag', 'piece', 'litre'];

const PRODUCT_STATUSES = ['available', 'unavailable', 'removed', 'sold', 'hidden'];
const VAT_MODES = ['none', 'inclusive', 'exclusive'];
const MANAGEABLE_PRODUCT_STATUSES = ['available', 'unavailable'];

const productSchema = new mongoose.Schema(
  {
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 90
    },
    category: {
      type: String,
      required: true,
      enum: CATEGORIES
    },
    description: {
      type: String,
      trim: true,
      maxlength: 600,
      default: ''
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      max: 100000000
    },
    unit: {
      type: String,
      required: true,
      enum: UNITS
    },
    price: {
      type: Number,
      required: true,
      min: 0.01,
      max: 100000000
    },
    currency: {
      type: String,
      enum: ['FJD'],
      default: 'FJD'
    },
    vatMode: {
      type: String,
      enum: VAT_MODES,
      default: 'none'
    },
    vatRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    location: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    harvestDate: {
      type: Date,
      default: null
    },
    image: {
      filename: {
        type: String,
        trim: true,
        maxlength: 180,
        default: ''
      },
      path: {
        type: String,
        trim: true,
        maxlength: 500,
        default: ''
      },
      mimetype: {
        type: String,
        enum: [...ALLOWED_PRODUCT_IMAGE_MIME_TYPES, ''],
        default: ''
      },
      size: {
        type: Number,
        min: 0,
        max: MAX_PRODUCT_IMAGE_SIZE_BYTES,
        default: 0
      },
      originalName: {
        type: String,
        trim: true,
        maxlength: 180,
        default: ''
      }
    },
    status: {
      type: String,
      enum: PRODUCT_STATUSES,
      default: 'available',
      index: true
    },
    analytics: {
      viewCount: {
        type: Number,
        min: 0,
        default: 0
      },
      requestCount: {
        type: Number,
        min: 0,
        default: 0
      },
      contactCount: {
        type: Number,
        min: 0,
        default: 0
      }
    },
    removedAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  {
    timestamps: true
  }
);

productSchema.index({ name: 'text', category: 'text', location: 'text', description: 'text' });
productSchema.index({ farmer: 1, status: 1, createdAt: -1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ status: 1, price: 1, quantity: -1 });
productSchema.index({ 'analytics.viewCount': -1, 'analytics.requestCount': -1 });

module.exports = {
  Product: mongoose.model('Product', productSchema),
  PRODUCT_CATEGORIES: CATEGORIES,
  PRODUCT_UNITS: UNITS,
  PRODUCT_STATUSES,
  MANAGEABLE_PRODUCT_STATUSES,
  VAT_MODES
};
