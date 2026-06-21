const crypto = require('crypto');

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const first = Buffer.from(a, 'utf8');
  const second = Buffer.from(b, 'utf8');

  if (first.length !== second.length) return false;

  return crypto.timingSafeEqual(first, second);
}

function attachCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = createToken();
  }

  res.locals.csrfToken = req.session.csrfToken;
  next();
}
function attachCsrfTokenForAuthenticatedUser(
    req,
    res,
    next
) {
    res.locals.csrfToken = null;

    if (!req.session.user?.id) {
        return next();
    }

    return attachCsrfToken(req, res, next);
}
function verifyCsrfToken(req, res, next) {
    const suppliedToken =
        req.body._csrf ||
        req.get('x-csrf-token');

    const sessionToken =
        req.session.csrfToken;

    if (!safeCompare(suppliedToken, sessionToken)) {
        const error = new Error(
            'Invalid CSRF token. Please refresh the page and try again.'
        );

        error.status = 403;

        return next(error);
    }

    // Important:
    // POST routes that re-render a form after validation errors
    // need the token available in the view again.
    // Some tests or lightweight mocks may not provide res.locals.
    res.locals = res.locals || {};
    res.locals.csrfToken = sessionToken;

    return next();
}

module.exports = {
    attachCsrfToken,
    attachCsrfTokenForAuthenticatedUser,
    verifyCsrfToken
};
