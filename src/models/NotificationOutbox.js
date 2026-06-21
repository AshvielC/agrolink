const mongoose = require('mongoose');

const ACTOR_ROLES = ['buyer', 'farmer', 'admin', 'system'];
const OUTBOX_STATUSES = ['pending', 'processing', 'delivered', 'failed'];

const notificationPayloadSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    actorRole: {
      type: String,
      enum: ACTOR_ROLES,
      default: 'system'
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    link: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    }
  },
  {
    _id: false
  }
);

const notificationOutboxSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['notification'],
      default: 'notification',
      index: true
    },
    status: {
      type: String,
      enum: OUTBOX_STATUSES,
      default: 'pending',
      index: true
    },
    payload: {
      type: notificationPayloadSchema,
      required: true
    },
    attempts: {
      type: Number,
      min: 0,
      default: 0
    },
    maxAttempts: {
      type: Number,
      min: 1,
      default: 8
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    lockedAt: {
      type: Date,
      default: null
      
    },
    lockedBy: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ''
    },
    deliveredAt: {
      type: Date,
      default: null
    },
    notification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      default: null
    },
    lastError: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

notificationOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
notificationOutboxSchema.index({ lockedAt: 1 });
notificationOutboxSchema.index({ 'payload.recipient': 1, createdAt: -1 });

module.exports = mongoose.model('NotificationOutbox', notificationOutboxSchema);
module.exports.OUTBOX_STATUSES = OUTBOX_STATUSES;
