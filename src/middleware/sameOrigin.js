const config = require('../config/env');

const SAFE_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS'
]);

function normalizeOrigin(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.origin.toLowerCase();
  } catch (error) {
    return '';
  }
}

function requestOrigin(req) {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || '';

  if (!host) return '';

  return `${protocol}://${host}`.toLowerCase();
}

function allowedOriginsForRequest(req) {
  const allowed = new Set();
  const appOrigin = normalizeOrigin(config.appUrl);
  const currentOrigin = requestOrigin(req);

  if (appOrigin) allowed.add(appOrigin);
  if (currentOrigin) allowed.add(currentOrigin);

  return allowed;
}

function sourceOrigin(req) {
  const origin = normalizeOrigin(req.get('origin'));

  if (origin) return origin;

  return normalizeOrigin(req.get('referer'));
}

function sameOriginUnsafeRequestGuard(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) {
    return next();
  }

  const source = sourceOrigin(req);

  if (!source) {
    if (!config.isProduction) {
      return next();
    }

    return res.status(403).send(
      'Cross-site request protection blocked this request. Please refresh the page and try again.'
    );
  }

  if (!allowedOriginsForRequest(req).has(source)) {
    return res.status(403).send(
      'Cross-site request protection blocked this request. Please refresh the page and try again.'
    );
  }

  return next();
}

module.exports = {
  allowedOriginsForRequest,
  sameOriginUnsafeRequestGuard,
  sourceOrigin
};
