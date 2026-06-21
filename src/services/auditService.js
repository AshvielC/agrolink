const AuditLog = require('../models/AuditLog');
const {
    getClientIp
} = require('../utils/requestIp');
const {
    logger
} = require('./loggerService');
const {
    sanitizeRequestPath
} = require('../utils/safeRequestPath');

function sessionActor(req, fallback = {}) {
  const sessionUser = req?.session?.user;

  return {
    actor: fallback.actor || sessionUser?.id || null,
    actorRole: fallback.actorRole || sessionUser?.role || 'system',
    actorName: fallback.actorName || sessionUser?.name || '',
    actorEmail: fallback.actorEmail || sessionUser?.email || ''
  };
}

function inferCategory(action = '') {
    const prefix = String(action || '').split('.')[0];

    if (['auth', 'document', 'profile', 'product', 'order', 'message', 'report'].includes(prefix)) {
        return prefix;
    }

    if (prefix === 'user') return 'admin';

    return 'system';
}

async function recordAuditLog(req, details = {}) {
  try {
    if (!details.action) return null;

    const actor = sessionActor(req, details);
      const ipAddress =
          getClientIp(req);

    return AuditLog.create({
      ...actor,
      action: details.action,
      targetType: details.targetType || '',
      target: details.target || null,
      targetLabel: details.targetLabel || '',
      category: details.category || inferCategory(details.action),
      severity: details.severity || 'info',
      message: details.message || '',
      metadata: details.metadata || {},
      ipAddress,
      userAgent: req?.get?.('user-agent') || '',
      method: req?.method || '',
        path: sanitizeRequestPath(
            req?.originalUrl || req?.url || ''
        ),
      requestId: req?.id || ''
    });
  } catch (error) {
    // Audit logging should never break the user-facing workflow.
    if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
        logger.error(
            'Audit log failed.',
            {
                event: 'audit.write.failed',
                error
            }
        );
    }
    return null;
  }
}

module.exports = {
  recordAuditLog
};
