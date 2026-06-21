const config = require('../config/env');
const {
    logger
} = require('../services/loggerService');

const {
    getSafeRequestPath
} = require('./requestLogger');

function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    const status = err.status || 500;

    if (status >= 500) {
        logger.error(
            'Unhandled request error.',
            {
                event: 'http.request.failed',
                requestId: req.id || '',
                method: req.method || '',
                path: getSafeRequestPath(req),
                statusCode: status,
                error: err
            }
        );
    }

    return res
        .status(status)
        .render('errors/error', {
            title:
                status === 403
                    ? 'Access denied'
                    : 'Something went wrong',
            status,
            message:
                status >= 500 &&
                    config.isProduction
                    ? 'Something went wrong.'
                    : err.message
        });
}

module.exports = errorHandler;