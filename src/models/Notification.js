const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    actorRole: {
      type: String,
      enum: ['buyer', 'farmer', 'admin', 'system'],
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
    },
    readAt: {
      type: Date,
      default: null,
      index: true
    },
    outboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationOutbox',
      default: null,
      index: true
    }
  },
  {
    timestamps: true
  }
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
notificationSchema.index(
  { outboxId: 1 },
  { unique: true, sparse: true, name: 'notification_outbox_unique' }
);

module.exports = mongoose.model('Notification', notificationSchema);
