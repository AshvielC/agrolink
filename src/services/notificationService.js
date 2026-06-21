const NotificationOutbox = require('../models/NotificationOutbox');
const User = require('../models/User');

const {
    logger
} = require('./loggerService');

const MAX_NOTIFICATION_TITLE_LENGTH = 120;
const MAX_NOTIFICATION_MESSAGE_LENGTH = 500;
const MAX_NOTIFICATION_LINK_LENGTH = 500;

function truncate(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeObjectId(value) {
  return value || null;
}

function normalizeNotificationPayload({
  recipient,
  actor = null,
  actorRole = 'system',
  title,
  message,
  link = ''
} = {}) {
  const normalized = {
    recipient: normalizeObjectId(recipient),
    actor: normalizeObjectId(actor),
    actorRole: ['buyer', 'farmer', 'admin', 'system'].includes(actorRole)
      ? actorRole
      : 'system',
    title: truncate(title, MAX_NOTIFICATION_TITLE_LENGTH),
    message: truncate(message, MAX_NOTIFICATION_MESSAGE_LENGTH),
    link: truncate(link, MAX_NOTIFICATION_LINK_LENGTH)
  };

  if (!normalized.recipient || !normalized.title || !normalized.message) {
    return null;
  }

  return normalized;
}

function logOutboxFailure(label, error, details = {}) {
    logger.error(
        label,
        {
            event: 'notification_outbox.enqueue.failed',
            error,
            recipient:
                details.recipient?.toString?.() ||
                String(details.recipient || ''),
            actorRole:
                details.actorRole || 'system'
        }
    );
}

async function enqueueNotification(details = {}, options = {}) {
  const payload = normalizeNotificationPayload(details);

  if (!payload) {
    return null;
  }

  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 8);
  const doc = {
    type: 'notification',
    status: 'pending',
    payload,
    attempts: 0,
    maxAttempts,
    nextAttemptAt: new Date()
  };

  if (options.session) {
    const [queued] = await NotificationOutbox.create([doc], {
      session: options.session
    });

    return queued;
  }

  return NotificationOutbox.create(doc);
}

async function createNotification(details = {}, options = {}) {
  try {
    return await enqueueNotification(details, options);
  } catch (error) {
    logOutboxFailure('Notification outbox enqueue failed:', error, details);
    return null;
  }
}

async function createOrderNotification(details = {}, options = {}) {
  return createNotification(details, options);
}

async function createAdminNotifications(
  {
    actor = null,
    actorRole = 'system',
    title,
    message,
    link = ''
  } = {},
  options = {}
) {
  try {
    const query = User.find({
      role: 'admin',
      accountStatus: 'active'
    })
      .select('_id')
      .lean();

    if (options.session) {
      query.session(options.session);
    }

    const admins = await query;

    if (!admins.length) {
      return [];
    }

    const outboxDocs = admins
      .map((admin) =>
        normalizeNotificationPayload({
          recipient: admin._id,
          actor,
          actorRole,
          title,
          message,
          link
        })
      )
      .filter(Boolean)
      .map((payload) => ({
        type: 'notification',
        status: 'pending',
        payload,
        attempts: 0,
        maxAttempts: Math.max(1, Number(options.maxAttempts) || 8),
        nextAttemptAt: new Date()
      }));

    if (!outboxDocs.length) {
      return [];
    }

    if (options.session) {
      return NotificationOutbox.create(outboxDocs, {
        session: options.session
      });
    }

    return NotificationOutbox.insertMany(outboxDocs, {
      ordered: false
    });
  } catch (error) {
    logOutboxFailure('Admin notification outbox enqueue failed:', error, {
      actorRole
    });

    return [];
  }
}

module.exports = {
  createNotification,
  createOrderNotification,
  createAdminNotifications,
  enqueueNotification
};
