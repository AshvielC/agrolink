const mongoose = require('mongoose');

const EMAIL_STATUSES = ['pending', 'sent', 'skipped', 'failed'];

const contactMessageSchema = new mongoose.Schema(
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
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 4,
      maxlength: 120
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1500
    },
    buyerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address.']
    },
    buyerPhone: {
      type: String,
      trim: true,
      maxlength: 40,
      default: ''
    },
    emailStatus: {
      type: String,
      enum: EMAIL_STATUSES,
      default: 'pending',
      index: true
    },
    emailError: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ''
    },
    productSnapshot: {
      name: { type: String, trim: true, maxlength: 90, default: '' },
      category: { type: String, trim: true, maxlength: 60, default: '' },
      price: { type: Number, min: 0, default: 0 },
      currency: { type: String, trim: true, maxlength: 10, default: 'FJD' },
      location: { type: String, trim: true, maxlength: 120, default: '' }
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

contactMessageSchema.index({ farmer: 1, createdAt: -1 });
contactMessageSchema.index({ buyer: 1, createdAt: -1 });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
module.exports.EMAIL_STATUSES = EMAIL_STATUSES;
