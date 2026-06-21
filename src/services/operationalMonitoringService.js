const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config/env');
const { logger } = require('./loggerService');

const BYTES_PER_MB = 1024 * 1024;
const projectRoot = path.resolve(__dirname, '..', '..');

const eventWindows = new Map();
const lastAlertAt = new Map();
let storageTimer = null;
let previousStorageBytes = null;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function monitoringConfig() {
  return config.monitoring || {};
}

function cooldownMs() {
  return positiveNumber(
    monitoringConfig().alertCooldownMinutes,
    15
  ) * 60 * 1000;
}

function triggerOperationalAlert(
  alertType,
  message,
  metadata = {},
  { bypassCooldown = false } = {}
) {
  const now = Date.now();
  const previousAlertAt = lastAlertAt.get(alertType) || 0;

  if (
    !bypassCooldown &&
    now - previousAlertAt < cooldownMs()
  ) {
    logger.debug(
      'Operational alert suppressed during cooldown.',
      {
        event: 'monitor.alert.suppressed',
        alertType
      }
    );

    return false;
  }

  lastAlertAt.set(alertType, now);

  logger.error(message, {
    event: 'monitor.alert.triggered',
    alertType,
    ...metadata
  });

  return true;
}

function recordWindowedEvent({
  key,
  threshold,
  windowMinutes,
  alertType,
  message,
  metadata = {}
}) {
  const now = Date.now();
  const windowMs = positiveNumber(windowMinutes, 5) * 60 * 1000;
  const cutoff = now - windowMs;
  const recent = (eventWindows.get(key) || [])
    .filter((timestamp) => timestamp >= cutoff);

  recent.push(now);
  eventWindows.set(key, recent);

  if (recent.length < positiveNumber(threshold, 1)) {
    return false;
  }

  return triggerOperationalAlert(
    alertType,
    message,
    {
      ...metadata,
      eventCount: recent.length,
      windowMinutes: positiveNumber(windowMinutes, 5)
    }
  );
}

function recordHttpResponse(statusCode, metadata = {}) {
  const normalizedStatus = Number(statusCode || 0);

  if (normalizedStatus < 500) return false;

  const settings = monitoringConfig();

  return recordWindowedEvent({
    key: 'http.5xx',
    threshold: settings.http5xxMaxErrors,
    windowMinutes: settings.http5xxWindowMinutes,
    alertType: 'http.5xx.spike',
    message: 'HTTP 5xx response spike detected.',
    metadata: {
      ...metadata,
      statusCode: normalizedStatus
    }
  });
}

function recordAccountLockout(metadata = {}) {
  const settings = monitoringConfig();

  return recordWindowedEvent({
    key: 'auth.account_lockout',
    threshold: settings.accountLockoutMaxEvents,
    windowMinutes: settings.accountLockoutWindowMinutes,
    alertType: 'auth.account_lockout.spike',
    message: 'Unusual account-lockout activity detected.',
    metadata
  });
}

function recordMongoDisconnected(metadata = {}) {
  return triggerOperationalAlert(
    'database.disconnected',
    'MongoDB connection was lost.',
    metadata
  );
}

function recordScannerStartupFailure(error) {
  return triggerOperationalAlert(
    'upload_scanner.startup.failure',
    'Upload virus scanner startup check failed.',
    { error },
    { bypassCooldown: true }
  );
}

function recordScannerQueueOverflow(metadata = {}) {
  return triggerOperationalAlert(
    'upload_scanner.queue_overflow',
    'Upload scanner queue overflow detected.',
    metadata
  );
}

function recordQpdfFailure(stage, error, metadata = {}) {
  return triggerOperationalAlert(
    'pdf_security_tool.failure',
    'PDF security tool failure detected.',
    {
      stage,
      error,
      ...metadata
    }
  );
}

function recordSmtpFailure(error) {
  return triggerOperationalAlert(
    'smtp.failure',
    'SMTP delivery failure detected.',
    { error }
  );
}
function recordPasswordResetThrottled(details = {}) {
    logger.warn(
        'Password reset request blocked by per-account throttling.',
        {
            event:
                'monitor.alert.triggered',
            alertType:
                'auth.password_reset.throttled',
            userId:
                details.userId || '',
            windowMinutes:
                Number(details.windowMinutes || 0),
            maxRequests:
                Number(details.maxRequests || 0)
        }
    );
}


function recordNotificationOutboxPermanentFailure(metadata = {}) {
  return triggerOperationalAlert(
    'notification_outbox.permanent_failure',
    'Notification outbox item permanently failed.',
    metadata
  );
}

function trackedStorageDirectories() {
  return [
    'public/uploads/products',
    'public/uploads/profiles',
    'storage/user-documents',
    'storage/report-evidence'
  ];
}

async function directorySizeBytes(directoryPath) {
  let entries;

  try {
    entries = await fs.readdir(directoryPath, {
      withFileTypes: true
    });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  let total = 0;

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      total += await directorySizeBytes(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const stats = await fs.stat(fullPath);
    total += stats.size;
  }

  return total;
}

async function checkStorageUsage() {
  const directories = trackedStorageDirectories();
  const usageByDirectory = {};
  let storageBytes = 0;

  for (const relativePath of directories) {
    const bytes = await directorySizeBytes(
      path.join(projectRoot, relativePath)
    );

    usageByDirectory[relativePath] = bytes;
    storageBytes += bytes;
  }

  const growthBytes =
    previousStorageBytes === null
      ? 0
      : Math.max(0, storageBytes - previousStorageBytes);

  logger.info('Application storage usage measured.', {
    event: 'storage.usage.measured',
    storageBytes,
    storageMb: Number(
      (storageBytes / BYTES_PER_MB).toFixed(2)
    ),
    growthBytes,
    usageByDirectory
  });

  const settings = monitoringConfig();
  const warningBytes = positiveNumber(
    settings.storageWarningMb,
    1024
  ) * BYTES_PER_MB;

  const growthWarningBytes = positiveNumber(
    settings.storageGrowthWarningMb,
    100
  ) * BYTES_PER_MB;

  if (storageBytes >= warningBytes) {
    triggerOperationalAlert(
      'storage.capacity.warning',
      'Application storage usage exceeded the warning threshold.',
      {
        storageBytes,
        warningBytes,
        usageByDirectory
      }
    );
  }

  if (
    previousStorageBytes !== null &&
    growthBytes >= growthWarningBytes
  ) {
    triggerOperationalAlert(
      'storage.growth.warning',
      'Application storage growth exceeded the warning threshold.',
      {
        storageBytes,
        growthBytes,
        growthWarningBytes,
        usageByDirectory
      }
    );
  }

  previousStorageBytes = storageBytes;

  return {
    storageBytes,
    growthBytes,
    usageByDirectory
  };
}

async function runStorageCheckSafely() {
  try {
    await checkStorageUsage();
  } catch (error) {
    triggerOperationalAlert(
      'storage.check.failure',
      'Application storage usage check failed.',
      { error }
    );
  }
}

function startOperationalMonitoring() {
  if (storageTimer) return;

  void runStorageCheckSafely();

  const intervalMs = positiveNumber(
    monitoringConfig().storageCheckIntervalMinutes,
    10
  ) * 60 * 1000;

  storageTimer = setInterval(() => {
    void runStorageCheckSafely();
  }, intervalMs);

  storageTimer.unref?.();
}

function stopOperationalMonitoring() {
  if (!storageTimer) return;

  clearInterval(storageTimer);
  storageTimer = null;
}

function resetOperationalMonitoringForTests() {
  stopOperationalMonitoring();
  eventWindows.clear();
  lastAlertAt.clear();
  previousStorageBytes = null;
}

module.exports = {
  checkStorageUsage,
  recordAccountLockout,
  recordHttpResponse,
  recordMongoDisconnected,
  recordNotificationOutboxPermanentFailure,
  recordQpdfFailure,
  recordScannerQueueOverflow,
  recordScannerStartupFailure,
  recordSmtpFailure,
  resetOperationalMonitoringForTests,
  startOperationalMonitoring,
    stopOperationalMonitoring,
    recordPasswordResetThrottled,
  triggerOperationalAlert
};
