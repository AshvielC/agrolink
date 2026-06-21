const rateLimitPackage =
    require('express-rate-limit');

const rateLimit =
    rateLimitPackage.rateLimit ||
    rateLimitPackage.default ||
    rateLimitPackage;

const config = require('../config/env');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message:
        'Too many attempts from this network. Please try again later.'
});

const passwordResetLimiter = rateLimit({
    windowMs:
        Math.max(
            1,
            config.security.passwordResetWindowMinutes
        ) *
        60 *
        1000,

    limit: Math.max(
        1,
        config.security.passwordResetMaxRequests
    ),

    standardHeaders: 'draft-7',
    legacyHeaders: false,

    message:
        'Too many password reset attempts from this network. Please try again later.'
});

const adminSensitiveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    message:
        'Too many sensitive admin requests. Please try again later.'
});

const signupUploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 6,
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    message:
        'Too many signup uploads from this network. Please try again later.'
});

const uploadIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    message:
        'Too many upload requests from this network. Please try again later.'
});

const uploadAccountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    keyGenerator(req) {
        return `account:${String(
            req.session?.user?.id || 'missing-user'
        )}`;
    },

    message:
        'Too many upload requests from this account. Please try again later.'
});

module.exports = {
    authLimiter,
    passwordResetLimiter,
    adminSensitiveLimiter,
    signupUploadLimiter,
    uploadIpLimiter,
    uploadAccountLimiter
};