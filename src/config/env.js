require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

const WEAK_SECRET_VALUES = new Set([
  'replace-with-a-long-random-secret-at-least-32-characters',
  'replace-with-another-long-random-secret-at-least-32-characters',
  'development-session-secret-change-me',
  'development-cookie-secret-change-me',
  'generate-a-random-48-byte-hex-secret',
  'generate-a-different-random-48-byte-hex-secret',
  'replace-with-a-strong-admin-password',
  'changethis12345',
  'change-me',
  'changeme'
]);

function booleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function numberEnv(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function isWeakSecret(value = '') {
  const normalized = String(value || '').trim();

  if (normalized.length < 32) return true;
  if (WEAK_SECRET_VALUES.has(normalized)) return true;
  if (/^(.)\1+$/.test(normalized)) return true;
  if (/replace|changeme|change-this|secret|password/i.test(normalized)) return true;

  return false;
}

const logLevel = String(
    process.env.LOG_LEVEL || 'info'
)
    .trim()
    .toLowerCase();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: numberEnv(process.env.PORT, 3000),
  mongoUri: process.env.MONGODB_URI,
  sessionSecret: process.env.SESSION_SECRET || 'development-session-secret-change-me',
  cookieSecret: process.env.COOKIE_SECRET || 'development-cookie-secret-change-me',
  appName: process.env.APP_NAME || 'AgroLink',
  appUrl: process.env.APP_URL || '',

  logging: {
    level: VALID_LOG_LEVELS.has(logLevel) ? logLevel : 'info'
  },

  trustProxyHops: Math.max(
        0,
        Math.floor(
            numberEnv(
                process.env.TRUST_PROXY_HOPS,
                0
            )
        )
    ),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: numberEnv(process.env.SMTP_PORT, 587),
    secure: booleanEnv(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  },
  email: {
    from: process.env.EMAIL_FROM || ''
  },
  notifications: {
    outbox: {
      enabled: booleanEnv(process.env.NOTIFICATION_OUTBOX_ENABLED, true),
      pollIntervalMs: Math.max(
        1000,
        numberEnv(process.env.NOTIFICATION_OUTBOX_POLL_INTERVAL_MS, 5000)
      ),
      batchSize: Math.max(
        1,
        numberEnv(process.env.NOTIFICATION_OUTBOX_BATCH_SIZE, 25)
      ),
      lockStaleMs: Math.max(
        30000,
        numberEnv(process.env.NOTIFICATION_OUTBOX_LOCK_STALE_MS, 300000)
      ),
      baseRetryDelayMs: Math.max(
        1000,
        numberEnv(process.env.NOTIFICATION_OUTBOX_BASE_RETRY_DELAY_MS, 30000)
      ),
      maxRetryDelayMs: Math.max(
        10000,
        numberEnv(process.env.NOTIFICATION_OUTBOX_MAX_RETRY_DELAY_MS, 1800000)
      )
    }
  },
  security: {
    maxFailedLoginAttempts: numberEnv(process.env.MAX_FAILED_LOGIN_ATTEMPTS, 5),
    loginLockoutMinutes: numberEnv(process.env.LOGIN_LOCKOUT_MINUTES, 15),
      passwordResetWindowMinutes: numberEnv(process.env.PASSWORD_RESET_WINDOW_MINUTES, 15),
      passwordResetMaxRequests: numberEnv(process.env.PASSWORD_RESET_MAX_REQUESTS, 5),
      passwordResetAccountMaxRequests: numberEnv(process.env.PASSWORD_RESET_ACCOUNT_MAX_REQUESTS, 3),
      adminReauthMinutes: numberEnv(process.env.ADMIN_REAUTH_MINUTES, 15),
      uploadVirusScanRequired: booleanEnv(
          process.env.UPLOAD_VIRUS_SCAN_REQUIRED,
          isProduction
      ),

      clamscanPath:
          process.env.CLAMSCAN_PATH || 'clamscan',

      uploadVirusScanTimeoutMs: Math.max(
          1000,
          numberEnv(
              process.env.UPLOAD_VIRUS_SCAN_TIMEOUT_MS,
              120000
          )
      ),

      uploadVirusScanStartupTimeoutMs: Math.max(
          1000,
          numberEnv(
              process.env.UPLOAD_VIRUS_SCAN_STARTUP_TIMEOUT_MS,
              180000
          )
      ),

      uploadVirusScanMaxConcurrent: Math.max(
          1,
          numberEnv(
              process.env.UPLOAD_VIRUS_SCAN_MAX_CONCURRENT,
              2
          )
      ),

      uploadVirusScanMaxQueued: Math.max(
          0,
          numberEnv(
              process.env.UPLOAD_VIRUS_SCAN_MAX_QUEUED,
              10
          )
      ),

      rejectEncryptedUploads: booleanEnv(
          process.env.REJECT_ENCRYPTED_UPLOADS,
          true
      ),

      pdfSecurityCheckRequired: booleanEnv(
          process.env.PDF_SECURITY_CHECK_REQUIRED,
          isProduction
      ),

      qpdfPath:
          process.env.QPDF_PATH || 'qpdf',

      pdfSecurityCheckTimeoutMs: Math.max(
          1000,
          numberEnv(
              process.env.PDF_SECURITY_CHECK_TIMEOUT_MS,
              15000
          )
      )
    },
    monitoring: {
        http5xxWindowMinutes:
            numberEnv(
                process.env.MONITOR_HTTP_5XX_WINDOW_MINUTES,
                5
            ),

        http5xxMaxErrors:
            numberEnv(
                process.env.MONITOR_HTTP_5XX_MAX_ERRORS,
                5
            ),

        accountLockoutWindowMinutes:
            numberEnv(
                process.env.MONITOR_ACCOUNT_LOCKOUT_WINDOW_MINUTES,
                15
            ),

        accountLockoutMaxEvents:
            numberEnv(
                process.env.MONITOR_ACCOUNT_LOCKOUT_MAX_EVENTS,
                5
            ),

        alertCooldownMinutes:
            numberEnv(
                process.env.MONITOR_ALERT_COOLDOWN_MINUTES,
                15
            ),

        storageCheckIntervalMinutes:
            numberEnv(
                process.env.MONITOR_STORAGE_CHECK_INTERVAL_MINUTES,
                10
            ),

        storageWarningMb:
            numberEnv(
                process.env.MONITOR_STORAGE_WARNING_MB,
                1024
            ),

        storageGrowthWarningMb:
            numberEnv(
                process.env.MONITOR_STORAGE_GROWTH_WARNING_MB,
                100
            )
    },
  admin: {
    name: process.env.ADMIN_NAME || 'AgroLink Admin',
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || ''
    },
    demo: {
        enabled: ['true', '1', 'yes', 'on'].includes(
            String(process.env.DEMO_MODE || 'false').trim().toLowerCase()
        ),
        notice:
            process.env.DEMO_NOTICE ||
            'Demo Mode: This platform is currently being tested. Please use test information only.'
    }
};

if (!config.mongoUri) {
    throw new Error('MONGODB_URI is missing. Check your .env file in the project root.');

}

function isLocalMongoUri(value = '') {
    return /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)/i.test(
        String(value || '')
    );
}

if (isProduction) {
  const missing = [];

  if (!process.env.MONGODB_URI) {
    missing.push('MONGODB_URI');
  } else if (isLocalMongoUri(process.env.MONGODB_URI)) {
    missing.push('MONGODB_URI production database, not localhost');
  }

  if (isWeakSecret(process.env.SESSION_SECRET)) {
    missing.push('SESSION_SECRET strong random value');
  }

  if (isWeakSecret(process.env.COOKIE_SECRET)) {
    missing.push('COOKIE_SECRET strong random value');
  }

  if (
    process.env.SESSION_SECRET &&
    process.env.COOKIE_SECRET &&
    process.env.SESSION_SECRET === process.env.COOKIE_SECRET
  ) {
    missing.push('SESSION_SECRET and COOKIE_SECRET must be different');
  }

  if (
    !process.env.APP_URL ||
    !/^https:\/\//i.test(process.env.APP_URL)
  ) {
    missing.push('APP_URL https URL');
  }

  if (
    !/^\d+$/.test(
      String(process.env.TRUST_PROXY_HOPS || '')
    )
  ) {
    missing.push('TRUST_PROXY_HOPS non-negative integer');
  }

  if (!VALID_LOG_LEVELS.has(logLevel)) {
    missing.push('LOG_LEVEL debug|info|warn|error');
  }

  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST');
  if (!process.env.SMTP_USER) missing.push('SMTP_USER');
  if (!process.env.SMTP_PASS) missing.push('SMTP_PASS');
  if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM');

  if (!config.security.uploadVirusScanRequired) {
    missing.push('UPLOAD_VIRUS_SCAN_REQUIRED=true');
  }

  if (!config.security.pdfSecurityCheckRequired) {
    missing.push('PDF_SECURITY_CHECK_REQUIRED=true');
  }

  if (config.notifications.outbox.enabled === false) {
    missing.push('NOTIFICATION_OUTBOX_ENABLED=true');
  }

  if (
    process.env.ADMIN_PASSWORD &&
    isWeakSecret(process.env.ADMIN_PASSWORD)
  ) {
    missing.push('ADMIN_PASSWORD strong value or leave unset after bootstrapping');
  }

  if (missing.length) {
    throw new Error(
      `Missing or weak production environment variables: ${missing.join(', ')}`
    );
  }
}

module.exports = config;
module.exports.isWeakSecret = isWeakSecret;
module.exports.booleanEnv = booleanEnv;
module.exports.VALID_LOG_LEVELS = VALID_LOG_LEVELS;
