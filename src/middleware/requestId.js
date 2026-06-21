const crypto = require('crypto');

function attachRequestId(req, res, next) {
  const incoming = String(req.get('x-request-id') || '').trim();
  const safeIncoming = /^[a-zA-Z0-9._:-]{8,80}$/.test(incoming) ? incoming : '';
  req.id = safeIncoming || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  return next();
}

module.exports = { attachRequestId };
