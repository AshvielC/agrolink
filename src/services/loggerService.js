const config = require('../config/env');

const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const REDACTED = '[REDACTED]';
const MAX_TEXT_LENGTH = 4000;
const MAX_DEPTH = 5;

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passphrase|secret|token|session|mongo(uri|db)?|smtp(pass|password)?|reset(url)?|api[-_]?key)/i;

function scrubText(value) {
  return String(value ?? '')
    .replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      'mongodb://[REDACTED]@'
    )
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
      'Bearer [REDACTED]'
    )
    .slice(0, MAX_TEXT_LENGTH);
}

function sanitizeValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(String(key))) {
    return REDACTED;
  }

  if (depth > MAX_DEPTH) {
    return '[MAX_DEPTH]';
  }

  if (value instanceof Error) {
    return {
      name: scrubText(value.name || 'Error'),
      message: scrubText(value.message || ''),
      code: scrubText(value.code || ''),
      stack: scrubText(value.stack || '')
    };
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeValue(item, '', depth + 1)
    );
  }

  if (value && typeof value === 'object') {
    const sanitized = {};

    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeValue(
        childValue,
        childKey,
        depth + 1
      );
    }

    return sanitized;
  }

  if (typeof value === 'string') {
    return scrubText(value);
  }

  return value;
}

function minimumLogPriority() {
  return LEVEL_PRIORITY[config.logging?.level] || LEVEL_PRIORITY.info;
}

function shouldLog(level) {
  return LEVEL_PRIORITY[level] >= minimumLogPriority();
}

function write(level, message, metadata = {}) {
  if (!shouldLog(level)) return;

  const safeMetadata = sanitizeValue(metadata);

  const entry = {
    ...(safeMetadata && typeof safeMetadata === 'object'
      ? safeMetadata
      : { metadata: safeMetadata }),
    timestamp: new Date().toISOString(),
    service: config.appName,
    environment: config.nodeEnv,
    level,
    message: scrubText(message)
  };

  const stream =
    level === 'warn' || level === 'error'
      ? process.stderr
      : process.stdout;

  stream.write(`${JSON.stringify(entry)}\n`);
}

const logger = {
  debug(message, metadata) {
    write('debug', message, metadata);
  },

  info(message, metadata) {
    write('info', message, metadata);
  },

  warn(message, metadata) {
    write('warn', message, metadata);
  },

  error(message, metadata) {
    write('error', message, metadata);
  }
};

module.exports = {
  logger,
  sanitizeValue,
  scrubText
};
