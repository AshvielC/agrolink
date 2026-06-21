const config = require('../config/env');

function safeReturnTo(value = '') {
    const raw = String(value || '').trim();

    if (!raw.startsWith('/')) {
        return '/dashboard/admin';
    }

    if (/^\/\/|[\\\r\n]/.test(raw)) {
        return '/dashboard/admin';
    }

    if (
        raw !== '/dashboard/admin' &&
        !raw.startsWith('/dashboard/admin/')
    ) {
        return '/dashboard/admin';
    }

    return raw;
}

function hasFreshAdminSession(req) {
    const reauthenticatedAt = Number(
        req.session.adminReauthenticatedAt || 0
    );

    const maxAgeMs =
        Math.max(1, config.security.adminReauthMinutes || 15) *
        60 *
        1000;

    return (
        reauthenticatedAt > 0 &&
        Date.now() - reauthenticatedAt <= maxAgeMs
    );
}

function resolveReturnTo(req, returnToResolver = '') {
    const requestedReturnTo =
        typeof returnToResolver === 'function'
            ? returnToResolver(req)
            : returnToResolver;

    if (requestedReturnTo) {
        return safeReturnTo(requestedReturnTo);
    }

    // A GET request can safely return to its original page.
    if (req.method === 'GET') {
        return safeReturnTo(
            req.originalUrl || '/dashboard/admin'
        );
    }

    // Do not try to replay POST requests automatically after reauthentication.
    return '/dashboard/admin';
}

function requireFreshAdminSessionFor(returnToResolver = '') {
    return function requireFreshAdminSessionForRoute(
        req,
        res,
        next
    ) {
        if (req.session.user?.role !== 'admin') {
            return res.status(403).render('errors/403', {
                title: 'Access denied'
            });
        }

        if (hasFreshAdminSession(req)) {
            return next();
        }

        req.session.adminReturnTo = resolveReturnTo(
            req,
            returnToResolver
        );

        req.session.error =
            'Please re-enter your admin password before continuing with this sensitive action.';

        return res.redirect('/dashboard/admin/reauth');
    };
}

const requireFreshAdminSession =
    requireFreshAdminSessionFor();

module.exports = {
    requireFreshAdminSession,
    requireFreshAdminSessionFor,
    safeReturnTo,
    hasFreshAdminSession
};