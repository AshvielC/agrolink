const os = require('os');

const config = require('../config/env');
const Notification = require('../models/Notification');
const NotificationOutbox = require('../models/NotificationOutbox');

const {
    logger
} = require('./loggerService');
const {
  recordNotificationOutboxPermanentFailure
} = require('./operationalMonitoringService');

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000;

let workerTimer = null;
let workerRunning = false;
let stopRequested = false;

function outboxConfig() {
  const settings = config.notifications?.outbox || {};

  return {
    enabled: settings.enabled !== false,
    pollIntervalMs: Math.max(1000, Number(settings.pollIntervalMs) || 5000),
    batchSize: Math.max(1, Number(settings.batchSize) || 25),
    lockStaleMs: Math.max(30000, Number(settings.lockStaleMs) || DEFAULT_LOCK_STALE_MS),
    baseRetryDelayMs: Math.max(1000, Number(settings.baseRetryDelayMs) || 30000),
    maxRetryDelayMs: Math.max(10000, Number(settings.maxRetryDelayMs) || 30 * 60 * 1000)
  };
}

function nextRetryAt(attempts, settings) {
  const exponent = Math.min(8, Math.max(0, Number(attempts || 0)));
  const delay = Math.min(
    settings.maxRetryDelayMs,
    settings.baseRetryDelayMs * 2 ** exponent
  );

  return new Date(Date.now() + delay);
}

function buildPendingFilter(settings) {
  const now = new Date();
  const staleBefore = new Date(Date.now() - settings.lockStaleMs);

  return {
    type: 'notification',
    $or: [
      {
        status: 'pending',
        nextAttemptAt: { $lte: now }
      },
      {
        status: 'processing',
        lockedAt: { $lte: staleBefore }
      }
    ]
  };
}

async function claimOutboxItem(settings) {
  return NotificationOutbox.findOneAndUpdate(
    buildPendingFilter(settings),
    {
      $set: {
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: WORKER_ID
      }
    },
    {
      sort: {
        nextAttemptAt: 1,
        createdAt: 1
      },
      new: true
    }
  );
}

async function markDelivered(outboxItem, notification) {
  await NotificationOutbox.updateOne(
    {
      _id: outboxItem._id
    },
    {
      $set: {
        status: 'delivered',
        deliveredAt: new Date(),
        notification: notification?._id || outboxItem.notification || null,
        lastError: '',
        lockedAt: null,
        lockedBy: ''
      }
    }
  );
}

async function markFailed(outboxItem, error, settings) {
  const nextAttempts = Number(outboxItem.attempts || 0) + 1;
  const permanentlyFailed = nextAttempts >= Number(outboxItem.maxAttempts || 8);
  const lastError = String(
    error?.message || error || 'Unknown notification delivery error'
  ).slice(0, 1000);

  await NotificationOutbox.updateOne(
    {
      _id: outboxItem._id
    },
    {
      $set: {
        status: permanentlyFailed ? 'failed' : 'pending',
        nextAttemptAt: permanentlyFailed ? new Date() : nextRetryAt(nextAttempts, settings),
        lastError,
        lockedAt: null,
        lockedBy: ''
      },
      $inc: {
        attempts: 1
      }
    }
  );

  if (permanentlyFailed) {
    recordNotificationOutboxPermanentFailure({
      outboxId: outboxItem._id?.toString?.() || '',
      attempts: nextAttempts,
      maxAttempts: Number(outboxItem.maxAttempts || 8),
      recipient: outboxItem.payload?.recipient?.toString?.() || '',
      error: lastError
    });
  }
}

async function deliverOutboxItem(outboxItem, settings) {
  const payload = outboxItem.payload || {};

  if (!payload.recipient || !payload.title || !payload.message) {
    await markFailed(outboxItem, new Error('Notification outbox item has an invalid payload.'), settings);
    return false;
  }

  try {
    const [notification] = await Notification.create([
      {
        recipient: payload.recipient,
        actor: payload.actor || null,
        actorRole: payload.actorRole || 'system',
        title: payload.title,
        message: payload.message,
        link: payload.link || '',
        outboxId: outboxItem._id
      }
    ]);

    await markDelivered(outboxItem, notification);
    return true;
  } catch (error) {
    if (error?.code === 11000) {
      const existingNotification = await Notification.findOne({
        outboxId: outboxItem._id
      })
        .select('_id')
        .lean();

      if (existingNotification) {
        await markDelivered(outboxItem, existingNotification);
        return true;
      }
    }

    await markFailed(outboxItem, error, settings);
    return false;
  }
}

async function processNotificationOutboxBatch() {
  const settings = outboxConfig();

  if (!settings.enabled) {
    return {
      processed: 0,
      delivered: 0
    };
  }

  let processed = 0;
  let delivered = 0;

  for (let index = 0; index < settings.batchSize; index += 1) {
    const outboxItem = await claimOutboxItem(settings);

    if (!outboxItem) {
      break;
    }

    processed += 1;

    const ok = await deliverOutboxItem(outboxItem, settings);

    if (ok) {
      delivered += 1;
    }
  }

  return {
    processed,
    delivered
  };
}

async function runWorkerTick() {
  if (workerRunning || stopRequested) {
    return;
  }

  workerRunning = true;

  try {
    const result = await processNotificationOutboxBatch();

      if (result.processed) {
          logger.info(
              'Notification outbox batch processed.',
              {
                  event: 'notification_outbox.batch.processed',
                  processed: result.processed,
                  delivered: result.delivered
              }
          );
      }
  } catch (error) {
      logger.error(
          'Notification outbox worker failed.',
          {
              event: 'notification_outbox.worker.failed',
              error
          }
      );
  } finally {
    workerRunning = false;
  }
}

function startNotificationOutboxWorker() {
  const settings = outboxConfig();

    if (!settings.enabled) {
        logger.info(
            'Notification outbox worker is disabled.',
            {
                event: 'notification_outbox.worker.disabled'
            }
        );

        return null;
    }

  if (workerTimer) {
    return workerTimer;
  }

  stopRequested = false;

  workerTimer = setInterval(() => {
    runWorkerTick();
  }, settings.pollIntervalMs);

  workerTimer.unref?.();
  setImmediate(runWorkerTick);

    logger.info(
        'Notification outbox worker started.',
        {
            event: 'notification_outbox.worker.started',
            pollIntervalMs: settings.pollIntervalMs,
            batchSize: settings.batchSize
        }
    );

  return workerTimer;
}

async function stopNotificationOutboxWorker() {
  stopRequested = true;

  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }

  const startedWaitingAt = Date.now();

  while (workerRunning && Date.now() - startedWaitingAt < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

module.exports = {
  processNotificationOutboxBatch,
  startNotificationOutboxWorker,
  stopNotificationOutboxWorker
};
