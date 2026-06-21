const mongoose = require('mongoose');
const {
  ALLOWED_REPORT_EVIDENCE_MIME_TYPES,
  MAX_REPORT_EVIDENCE_SIZE_BYTES
} = require('../config/productLimits');

const REPORT_TARGET_TYPES = ['product', 'order', 'message', 'user'];
const REPORT_REASONS = [
  'fake_listing',
  'wrong_product_information',
  'payment_issue',
  'order_not_fulfilled',
  'buyer_did_not_pay',
  'farmer_did_not_deliver',
  'abusive_message',
  'suspicious_account',
  'other'
];
const REPORT_STATUSES = ['open', 'under_review', 'resolved', 'rejected'];
const REPORT_ADMIN_ACTIONS = ['none', 'warned_user', 'suspended_user', 'removed_product', 'closed_without_action'];

const evidenceSchema = new mongoose.Schema(
  {
        filename: { type: String, trim: true, maxlength: 180, default: '' },
        storageKey: {
            type: String,
            trim: true,
            maxlength: 700,
            default: ''
        },
    storagePath: { type: String, trim: true, maxlength: 700, default: '' },
    mimetype: { type: String, enum: [...ALLOWED_REPORT_EVIDENCE_MIME_TYPES, ''], default: '' },
    size: { type: Number, min: 0, max: MAX_REPORT_EVIDENCE_SIZE_BYTES, default: 0 },
    originalName: { type: String, trim: true, maxlength: 180, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const reportHistorySchema = new mongoose.Schema(
  {
    action: { type: String, trim: true, maxlength: 90, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, enum: ['buyer', 'farmer', 'admin', 'system'], default: 'system' },
    note: { type: String, trim: true, maxlength: 800, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reporterRole: { type: String, enum: ['buyer', 'farmer', 'admin'], required: true, index: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    targetType: { type: String, enum: REPORT_TARGET_TYPES, required: true, index: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    reason: { type: String, enum: REPORT_REASONS, required: true, index: true },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    status: { type: String, enum: REPORT_STATUSES, default: 'open', index: true },
    adminAction: { type: String, enum: REPORT_ADMIN_ACTIONS, default: 'none' },
    adminNote: { type: String, trim: true, maxlength: 1200, default: '' },
    resolutionNote: { type: String, trim: true, maxlength: 1200, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null, index: true },
    evidence: [evidenceSchema],
    reporterSnapshot: {
      name: { type: String, trim: true, maxlength: 120, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
      role: { type: String, trim: true, maxlength: 30, default: '' },
      farmName: { type: String, trim: true, maxlength: 120, default: '' },
      organization: { type: String, trim: true, maxlength: 120, default: '' }
    },
    reportedUserSnapshot: {
      name: { type: String, trim: true, maxlength: 120, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
      role: { type: String, trim: true, maxlength: 30, default: '' },
      farmName: { type: String, trim: true, maxlength: 120, default: '' },
      organization: { type: String, trim: true, maxlength: 120, default: '' }
    },
    targetSnapshot: {
      title: { type: String, trim: true, maxlength: 180, default: '' },
      subtitle: { type: String, trim: true, maxlength: 250, default: '' },
      link: { type: String, trim: true, maxlength: 400, default: '' },
      status: { type: String, trim: true, maxlength: 80, default: '' }
    },
    history: [reportHistorySchema]
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reporter: 1, createdAt: -1 });
reportSchema.index({ reportedUser: 1, createdAt: -1 });
reportSchema.index({ reason: 1, status: 1 });
reportSchema.index({ 'targetSnapshot.title': 'text', description: 'text', adminNote: 'text', resolutionNote: 'text' });

module.exports = {
  Report: mongoose.model('Report', reportSchema),
  REPORT_TARGET_TYPES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_ADMIN_ACTIONS
};
