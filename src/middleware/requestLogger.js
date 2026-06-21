const { logger } = require('../services/loggerService');
const {
  recordHttpResponse
} = require(
  '../services/operationalMonitoringService'
);
const {
  sanitizeRequestPath
} = require('../utils/safeRequestPath');

function getSafeRequestPath(req) {
  if (req?.route?.path) {
    return sanitizeRequestPath(
      `${req.baseUrl || ''}${req.route.path}`
    );
  }

  return sanitizeRequestPath(req?.path || '');
}

function attachStructuredRequestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  let logged = false;

  function writeCompletionLog({ aborted = false } = {}) {
    if (logged) return;
    logged = true;

    const elapsedNanoseconds =
      process.hrtime.bigint() - startedAt;

    const durationMs = Number(
      Number(elapsedNanoseconds) / 1_000_000
    ).toFixed(1);

    const details = {
      event: aborted
        ? 'http.request.aborted'
        : 'http.request.completed',
      requestId: req.id || '',
      method: req.method || '',
      path: getSafeRequestPath(req),
      statusCode: res.statusCode,
      durationMs: Number(durationMs),
      actorRole:
        req.session?.user?.role || 'anonymous'
    };

    recordHttpResponse(
      res.statusCode,
      {
        requestId: req.id || '',
        method: req.method || '',
        path: getSafeRequestPath(req)
      }
    );

    if (aborted) {
      logger.warn('HTTP request aborted.', details);
      return;
    }

    if (res.statusCode >= 500) {
      logger.error('HTTP request completed with a server error.', details);
      return;
    }

    if (res.statusCode >= 400) {
      logger.warn('HTTP request completed with a client error.', details);
      return;
    }

    logger.info('HTTP request completed.', details);
  }

  res.once('finish', () => {
    writeCompletionLog();
  });

  res.once('close', () => {
    if (!res.writableEnded) {
      writeCompletionLog({ aborted: true });
    }
  });

  return next();
}

module.exports = {
  attachStructuredRequestLogger,
  getSafeRequestPath,
  sanitizeRequestPath
};
