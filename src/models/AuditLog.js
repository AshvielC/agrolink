const mongoose = require('mongoose');

const AUDIT_ACTIONS = [
  'user.signup',
  'user.viewed',
  'user.status_updated',
  'user.document_status_updated',
  'profile.updated',
  'product.created',
  'product.updated',
  'product.availability_updated',
  'product.removed',
  'order.created',
  'order.status_updated',
  'order.cancelled',
  'order.receipt_issued',
  'order.fulfillment_requested',
  'order.fulfillment_confirmed_by_buyer',
  'order.fulfillment_confirm',
  'order.fulfillment_reschedule',
  'order.fulfillment_complete',
  'order.fulfillment_cancel_schedule',
  'auth.login_success',
  'auth.login_failed',
  'auth.account_locked',
  'auth.account_unlocked',
  'auth.suspended_login_attempt',
    'auth.password_reset_requested',
    'auth.password_reset_throttled',
    'auth.password_reset_completed',
    'auth.password_reset_email_failed',
  'auth.admin_reauth_success',
  'auth.admin_reauth_failed',
    'document.viewed',
    'document.downloaded',
    'document.access_blocked',
    'document.file_missing',
    'security.dashboard_viewed',
  'message.sent',
  'message.replied',
  'report.created',
  'report.updated',
  'report.evidence_viewed',
  'report.evidence_downloaded',
  'report.evidence_blocked',
  'admin.export_csv',
  'admin.export_print_viewed'
];

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    actorRole: {
      type: String,
      enum: ['buyer', 'farmer', 'admin', 'system', ''],
      default: 'system'
    },
    actorName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ''
    },
    actorEmail: {
      type: String,
      trim: true,
      maxlength: 254,
      default: ''
    },
    action: {
      type: String,
      required: true,
      enum: AUDIT_ACTIONS,
      index: true
    },
        targetType: {
            type: String,
            enum: ['User', 'Product', 'OrderRequest', 'ContactMessage', 'Message', 'Report', 'System', ''],
            default: ''
        },
    target: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },
    targetLabel: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    },
        category: {
            type: String,
            enum: ['auth', 'admin', 'document', 'profile', 'product', 'order', 'message', 'report', 'system', 'security', 'export', ''],
            default: '',
            index: true
        },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
      index: true
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ''
    },
    method: {
      type: String,
      trim: true,
      maxlength: 12,
      default: ''
    },
    path: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ''
    },
    requestId: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    }
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, target: 1, createdAt: -1 });
auditLogSchema.index({ category: 1, severity: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
