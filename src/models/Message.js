const mongoose = require('mongoose');

const MESSAGE_EMAIL_STATUSES = ['pending', 'sent', 'skipped', 'failed'];
const MESSAGE_TYPES = ['general', 'product_enquiry', 'order_message', 'reply'];

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    senderRole: {
      type: String,
      enum: ['buyer', 'farmer', 'admin'],
      required: true,
      index: true
    },
    recipientRole: {
      type: String,
      enum: ['buyer', 'farmer', 'admin'],
      required: true,
      index: true
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 140
    },
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 2500
    },
    messageType: {
      type: String,
      enum: MESSAGE_TYPES,
      default: 'general',
      index: true
    },
    relatedProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true
    },
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderRequest',
      default: null,
      index: true
    },
    parentMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
      index: true
    },
    readAt: {
      type: Date,
      default: null,
      index: true
    },
    emailStatus: {
      type: String,
      enum: MESSAGE_EMAIL_STATUSES,
      default: 'pending',
      index: true
    },
    emailError: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    senderSnapshot: {
      name: { type: String, trim: true, maxlength: 120, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
      role: { type: String, trim: true, maxlength: 30, default: '' },
      farmName: { type: String, trim: true, maxlength: 120, default: '' },
      organization: { type: String, trim: true, maxlength: 120, default: '' }
    },
    recipientSnapshot: {
      name: { type: String, trim: true, maxlength: 120, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
      role: { type: String, trim: true, maxlength: 30, default: '' },
      farmName: { type: String, trim: true, maxlength: 120, default: '' },
      organization: { type: String, trim: true, maxlength: 120, default: '' }
    },
    productSnapshot: {
      name: { type: String, trim: true, maxlength: 120, default: '' },
      category: { type: String, trim: true, maxlength: 80, default: '' },
      location: { type: String, trim: true, maxlength: 140, default: '' }
    },
    orderSnapshot: {
      reference: { type: String, trim: true, maxlength: 60, default: '' },
      productName: { type: String, trim: true, maxlength: 120, default: '' },
      status: { type: String, trim: true, maxlength: 40, default: '' }
    }
  },
  {
    timestamps: true
  }
);

messageSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ subject: 'text', body: 'text' });

module.exports = mongoose.model('Message', messageSchema);
module.exports.MESSAGE_EMAIL_STATUSES = MESSAGE_EMAIL_STATUSES;
module.exports.MESSAGE_TYPES = MESSAGE_TYPES;
