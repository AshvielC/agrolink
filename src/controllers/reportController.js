
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const { Report, REPORT_REASONS, REPORT_STATUSES, REPORT_ADMIN_ACTIONS } = require('../models/Report');
const User = require('../models/User');
const { Product } = require('../models/Product');
const { OrderRequest } = require('../models/OrderRequest');
const Message = require('../models/Message');
const fs = require('fs/promises');
const {
    saveReportEvidence,
    deleteReportEvidence,
    resolveReportEvidencePath,
    isReportEvidencePathSafe
} = require(
    '../services/reportEvidenceService'
);

const {
    createNotification,
    createAdminNotifications
} = require('../services/notificationService');
const { recordAuditLog } = require('../services/auditService');
const { getOrderReference } = require('../services/orderPresentationService');

const TRANSACTION_OPTIONS = {
    readPreference: 'primary',
    writeConcern: { w: 'majority' }
};
const {
    recordStockMovement
} = require('../services/stockMovementService');
const {
    logger
} = require('../services/loggerService');
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
class ReportWorkflowError extends Error {
    constructor(message, redirectPath = '') {
        super(message);
        this.name = 'ReportWorkflowError';
        this.redirectPath = redirectPath;
    }
}

function reportWorkflowError(message, redirectPath = '') {
    return new ReportWorkflowError(message, redirectPath);
}

function redirectReportWorkflowError(
    req,
    res,
    error,
    fallbackPath
) {
    if (!(error instanceof ReportWorkflowError)) {
        return false;
    }

    req.session.error = error.message;

    res.redirect(error.redirectPath || fallbackPath);

    return true;
}

async function runBestEffort(label, task) {
    try {
        return await task();
    } catch (error) {
        logger.error(
            label,
            {
                event: 'workflow.best_effort.failed',
                error
            }
        );
        return null;
    }
}

function dashboardFor(role) {
  if (role === 'buyer') return '/dashboard/buyer';
  if (role === 'farmer') return '/dashboard/farmer';
  if (role === 'admin') return '/dashboard/admin';
  return '/dashboard';
}

function regex(value) {
  const safe = String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(safe, 'i');
}

function reasonLabel(reason) {
  const labels = {
    fake_listing: 'Fake product listing',
    wrong_product_information: 'Wrong product information',
    payment_issue: 'Payment issue',
    order_not_fulfilled: 'Order not fulfilled',
    buyer_did_not_pay: 'Buyer did not pay',
    farmer_did_not_deliver: 'Farmer did not deliver',
    abusive_message: 'Abusive message',
    suspicious_account: 'Suspicious account',
    other: 'Other'
  };
  return labels[reason] || reason;
}

function actionLabel(action) {
  const labels = {
    none: 'No action yet',
    warned_user: 'Warned user',
    suspended_user: 'Suspended user',
    removed_product: 'Removed product',
    closed_without_action: 'Closed without action'
  };
  return labels[action] || action;
}

function userSnapshot(user = {}) {
  return {
    name: user.name || '',
    email: user.email || '',
    role: user.role || '',
    farmName: user.farmerProfile?.farmName || '',
    organization: user.buyerProfile?.organization || ''
  };
}

async function resolveTargetForReporter({ targetType, targetId, currentUserId }) {
  if (!['product', 'order', 'message', 'user'].includes(targetType) || !isValidObjectId(targetId)) {
    return null;
  }

  const currentUserIdString = String(currentUserId);

  if (targetType === 'product') {
    const product = await Product.findById(targetId)
      .populate('farmer', 'name email role farmerProfile buyerProfile accountStatus')
      .lean();

    if (!product || !product.farmer || product.status === 'removed') return null;
    if (String(product.farmer._id) === currentUserIdString) return null;

    return {
      reportedUser: product.farmer._id,
      reportedUserSnapshot: userSnapshot(product.farmer),
      targetSnapshot: {
        title: product.name || 'Product listing',
        subtitle: `${product.category || 'Product'} · ${product.location || 'Location not set'}`,
        link: `/dashboard/buyer/products/${product._id}`,
        status: product.status || ''
      }
    };
  }

  if (targetType === 'order') {
    const order = await OrderRequest.findOne({
      _id: targetId,
      $or: [{ buyer: currentUserId }, { farmer: currentUserId }]
    })
      .populate('buyer', 'name email role farmerProfile buyerProfile accountStatus')
      .populate('farmer', 'name email role farmerProfile buyerProfile accountStatus')
      .lean();

    if (!order) return null;
    const reporterIsBuyer = String(order.buyer?._id || order.buyer) === currentUserIdString;
    const otherUser = reporterIsBuyer ? order.farmer : order.buyer;

    return {
      reportedUser: otherUser?._id || null,
      reportedUserSnapshot: userSnapshot(otherUser || {}),
      targetSnapshot: {
        title: `Order ${getOrderReference(order)}`,
        subtitle: `${order.productSnapshot?.name || 'Produce'} · ${order.requestedQuantity} ${order.unit || ''}`.trim(),
        link: reporterIsBuyer ? '/dashboard/buyer/orders' : '/dashboard/farmer/orders',
        status: order.status || ''
      }
    };
  }

  if (targetType === 'message') {
    const message = await Message.findOne({
      _id: targetId,
      $or: [{ sender: currentUserId }, { recipient: currentUserId }]
    })
      .populate('sender', 'name email role farmerProfile buyerProfile accountStatus')
      .populate('recipient', 'name email role farmerProfile buyerProfile accountStatus')
      .lean();

    if (!message) return null;
    const reporterIsSender = String(message.sender?._id || message.sender) === currentUserIdString;
    const otherUser = reporterIsSender ? message.recipient : message.sender;

    return {
      reportedUser: otherUser?._id || null,
      reportedUserSnapshot: userSnapshot(otherUser || {}),
      targetSnapshot: {
        title: message.subject || 'Message',
        subtitle: `${message.senderSnapshot?.name || message.sender?.name || 'Sender'} to ${message.recipientSnapshot?.name || message.recipient?.name || 'Recipient'}`,
        link: `/dashboard/messages/${message._id}`,
        status: message.readAt ? 'read' : 'unread'
      }
    };
  }

  const user = await User.findById(targetId)
    .select('name email role farmerProfile buyerProfile accountStatus')
    .lean();

  if (!user || String(user._id) === currentUserIdString || user.role === 'admin') return null;

  return {
    reportedUser: user._id,
    reportedUserSnapshot: userSnapshot(user),
    targetSnapshot: {
      title: user.farmerProfile?.farmName || user.buyerProfile?.organization || user.name || 'User',
      subtitle: `${user.email || ''} · ${user.role || 'user'}`,
      link: user.role === 'farmer' ? `/dashboard/buyer/farmers/${user._id}/profile` : '',
      status: user.accountStatus || ''
    }
  };
}

function reportQueryForUser(userId) {
  return Report.find({ reporter: userId })
    .populate('reportedUser', 'name email role farmerProfile buyerProfile accountStatus')
    .sort({ createdAt: -1 })
    .limit(100);
}

async function newReportForm(req, res, next) {
  try {
    const targetType = req.query.targetType || '';
    const targetId = req.query.targetId || '';
    const targetContext = await resolveTargetForReporter({
      targetType,
      targetId,
      currentUserId: req.session.user.id
    });

    if (!targetContext) {
      req.session.error = 'The report target was not found or cannot be reported from your account.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    return res.render('reports/form', {
      title: 'Submit a report',
      reasons: REPORT_REASONS,
      reasonLabel,
      targetType,
      targetId,
      targetContext,
      formData: { reason: '', description: '' },
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

async function createReport(req, res, next) {
    const savedEvidence = [];
    let reportSaved = false;

  try {
    const targetType = req.body.targetType || '';
    const targetId = req.body.targetId || '';
    const targetContext = await resolveTargetForReporter({
      targetType,
      targetId,
      currentUserId: req.session.user.id
    });

    if (!targetContext) {
      req.session.error = 'The report target was not found or cannot be reported from your account.';
      return res.redirect(dashboardFor(req.session.user.role));
    }

    const result = validationResult(req);
    const formData = {
      reason: req.body.reason || '',
      description: req.body.description || ''
    };
    const validationErrors = result.array();

    if (req.fileValidationError) {
      validationErrors.push({ msg: req.fileValidationError, path: 'evidence' });
    }

    if (validationErrors.length) {
      return res.status(422).render('reports/form', {
        title: 'Submit a report',
        reasons: REPORT_REASONS,
        reasonLabel,
        targetType,
        targetId,
        targetContext,
        formData,
        errors: validationErrors
      });
    }

    for (const file of req.files || []) {
      savedEvidence.push(await saveReportEvidence(file));
    }

    const reporter = await User.findById(req.session.user.id)
      .select('name email role farmerProfile buyerProfile')
      .lean();

    const report = await Report.create({
      reporter: req.session.user.id,
      reporterRole: req.session.user.role,
      reportedUser: targetContext.reportedUser,
      targetType,
      target: targetId,
      reason: formData.reason,
      description: formData.description,
      evidence: savedEvidence,
      reporterSnapshot: userSnapshot(reporter || req.session.user),
      reportedUserSnapshot: targetContext.reportedUserSnapshot,
      targetSnapshot: targetContext.targetSnapshot,
      history: [{
        action: 'Report submitted',
        actor: req.session.user.id,
        actorRole: req.session.user.role,
        note: reasonLabel(formData.reason)
      }]
    });
      reportSaved = true;
      await runBestEffort(
          'Admin report notification failed',
          () =>
              createAdminNotifications({
                  actor: req.session.user.id,
                  actorRole: req.session.user.role,
                  title: 'New report submitted',
                  message:
                      `${req.session.user.name} submitted a ` +
                      `${reasonLabel(report.reason)} report about ` +
                      `${report.targetSnapshot?.title || 'a marketplace record'}.`,
                  link: `/dashboard/admin/reports/${report._id}`
              })
      );

      await runBestEffort(
          'Report creation audit logging failed',
          () =>
              recordAuditLog(req, {
                  action: 'report.created',
                  targetType: 'Report',
                  target: report._id,
                  targetLabel:
                      report.targetSnapshot?.title ||
                      reasonLabel(report.reason),
                  category: 'report',
                  severity: 'warning',
                  message: 'User submitted a marketplace report.',
                  metadata: {
                      reportReason: report.reason,
                      reportTargetType: report.targetType,
                      evidenceCount: savedEvidence.length
                  }
              })
      );

    req.session.success = 'Your report was submitted. An administrator will review it.';
    return res.redirect('/dashboard/reports');
  } catch (error) {
      if (!reportSaved && savedEvidence.length) {
      try {
        await deleteReportEvidence(savedEvidence);
      } catch (cleanupError) {
        // Do not hide the original error.
      }
    }
    return next(error);
  }
}

async function myReports(req, res, next) {
  try {
    const reports = await reportQueryForUser(req.session.user.id).lean();
    return res.render('reports/index', {
      title: 'My reports',
      reports,
      reasonLabel,
      actionLabel
    });
  } catch (error) {
    return next(error);
  }
}

async function findReportForUser(req) {
  if (!isValidObjectId(req.params.id)) return null;
  const query = { _id: req.params.id };
  if (req.session.user.role !== 'admin') {
    query.reporter = req.session.user.id;
  }
  return Report.findOne(query)
    .populate('reporter', 'name email role farmerProfile buyerProfile accountStatus')
    .populate('reportedUser', 'name email role farmerProfile buyerProfile accountStatus')
    .populate('reviewedBy', 'name email role')
    .lean();
}

async function showReport(req, res, next) {
  try {
    const report = await findReportForUser(req);
    if (!report) {
      req.session.error = 'Report not found.';
      return res.redirect(req.session.user.role === 'admin' ? '/dashboard/admin/reports' : '/dashboard/reports');
    }

    return res.render(req.session.user.role === 'admin' ? 'admin/report-show' : 'reports/show', {
      title: `Report: ${report.targetSnapshot?.title || reasonLabel(report.reason)}`,
      report,
      reasonLabel,
      actionLabel,
      statuses: REPORT_STATUSES,
      adminActions: REPORT_ADMIN_ACTIONS,
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function printReport(req, res, next) {
  try {
    const report = await findReportForUser(req);
    if (!report) {
      req.session.error = 'Report not found.';
      return res.redirect(req.session.user.role === 'admin' ? '/dashboard/admin/reports' : '/dashboard/reports');
    }

    return res.render(req.session.user.role === 'admin' ? 'admin/report-show' : 'reports/show', {
      title: `Print report: ${report.targetSnapshot?.title || reasonLabel(report.reason)}`,
      report,
      reasonLabel,
      actionLabel,
      statuses: REPORT_STATUSES,
      adminActions: REPORT_ADMIN_ACTIONS,
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}

function reportListFilter(filters) {
  const filter = {};
  if (REPORT_STATUSES.includes(filters.status)) filter.status = filters.status;
  if (REPORT_REASONS.includes(filters.reason)) filter.reason = filters.reason;
  if (['product', 'order', 'message', 'user'].includes(filters.targetType)) filter.targetType = filters.targetType;

  if (filters.q) {
    const q = regex(filters.q);
    filter.$or = [
      { description: q },
      { adminNote: q },
      { resolutionNote: q },
      { 'reporterSnapshot.name': q },
      { 'reporterSnapshot.email': q },
      { 'reporterSnapshot.farmName': q },
      { 'reporterSnapshot.organization': q },
      { 'reportedUserSnapshot.name': q },
      { 'reportedUserSnapshot.email': q },
      { 'reportedUserSnapshot.farmName': q },
      { 'reportedUserSnapshot.organization': q },
      { 'targetSnapshot.title': q },
      { 'targetSnapshot.subtitle': q }
    ];
  }
  return filter;
}

async function adminReports(req, res, next) {
  try {
    const filters = {
      status: req.query.status || '',
      reason: req.query.reason || '',
      targetType: req.query.targetType || '',
      q: req.query.q || ''
    };

    const reports = await Report.find(reportListFilter(filters))
      .populate('reporter', 'name email role farmerProfile buyerProfile accountStatus')
      .populate('reportedUser', 'name email role farmerProfile buyerProfile accountStatus')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    return res.render('admin/reports', {
      title: 'Manage reports',
      reports,
      filters,
      statuses: REPORT_STATUSES,
      reasons: REPORT_REASONS,
      targetTypes: ['product', 'order', 'message', 'user'],
      reasonLabel,
      actionLabel,
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function adminReportsPrint(req, res, next) {
  try {
    const filters = {
      status: req.query.status || '',
      reason: req.query.reason || '',
      targetType: req.query.targetType || '',
      q: req.query.q || ''
    };

    const reports = await Report.find(reportListFilter(filters))
      .populate('reporter', 'name email role farmerProfile buyerProfile accountStatus')
      .populate('reportedUser', 'name email role farmerProfile buyerProfile accountStatus')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.render('admin/reports', {
      title: 'Print reports',
      reports,
      filters,
      statuses: REPORT_STATUSES,
      reasons: REPORT_REASONS,
      targetTypes: ['product', 'order', 'message', 'user'],
      reasonLabel,
      actionLabel,
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAdminReport(req, res, next) {
    try {
        if (!isValidObjectId(req.params.id)) {
            req.session.error = 'Report not found.';
            return res.redirect('/dashboard/admin/reports');
        }

        const result = validationResult(req);

        if (!result.isEmpty()) {
            req.session.error = result.array()[0].msg;

            return res.redirect(
                `/dashboard/admin/reports/${req.params.id}`
            );
        }

        const nextStatus = req.body.status;
        const adminAction = req.body.adminAction || 'none';
        const adminNote = String(
            req.body.adminNote || ''
        ).trim();

        const resolutionNote = String(
            req.body.resolutionNote || ''
        ).trim();

        let report = null;
        let previousStatus = '';

        await mongoose.connection.transaction(
            async (session) => {
                report = await Report.findById(
                    req.params.id
                ).session(session);

                if (!report) {
                    throw reportWorkflowError(
                        'Report not found.',
                        '/dashboard/admin/reports'
                    );
                }

                previousStatus = report.status;

                report.status = nextStatus;
                report.adminAction = adminAction;
                report.adminNote = adminNote;
                report.resolutionNote = resolutionNote;
                report.reviewedBy = req.session.user.id;
                report.reviewedAt = new Date();

                if (['resolved', 'rejected'].includes(nextStatus)) {
                    report.resolvedAt = new Date();
                } else {
                    report.resolvedAt = null;
                }

                report.history.push({
                    action: `Admin updated report to ${nextStatus}`,
                    actor: req.session.user.id,
                    actorRole: 'admin',
                    note: [
                        actionLabel(adminAction),
                        adminNote || resolutionNote
                    ]
                        .filter(Boolean)
                        .join(' · ')
                });

                if (adminAction === 'suspended_user') {
                    if (!report.reportedUser) {
                        throw reportWorkflowError(
                            'This report is not linked to a user account that can be suspended.',
                            `/dashboard/admin/reports/${report._id}`
                        );
                    }

                    const suspensionResult = await User.updateOne(
                        {
                            _id: report.reportedUser,
                            role: { $ne: 'admin' },
                            accountStatus: { $ne: 'suspended' }
                        },
                        {
                            $set: {
                                accountStatus: 'suspended',
                                suspendedAt: new Date(),
                                statusNote:
                                    'Suspended after admin report review.'
                            }
                        },
                        { session }
                    );

                    if (suspensionResult.matchedCount !== 1) {
                        throw reportWorkflowError(
                            'The reported user could not be suspended or is already suspended.',
                            `/dashboard/admin/reports/${report._id}`
                        );
                    }

                    report.history.push({
                        action: 'Reported user suspended',
                        actor: req.session.user.id,
                        actorRole: 'admin',
                        note: 'Admin selected suspend user.'
                    });
                }

                if (adminAction === 'removed_product') {
                    if (report.targetType !== 'product') {
                        throw reportWorkflowError(
                            'The remove-product action is available only for reports about product listings.',
                            `/dashboard/admin/reports/${report._id}`
                        );
                    }

                    const removedProduct =
                        await Product.findOneAndUpdate(
                            {
                                _id: report.target,
                                status: { $ne: 'removed' }
                            },
                            {
                                $set: {
                                    status: 'removed',
                                    removedAt: new Date()
                                }
                            },
                            {
                                new: true,
                                session
                            }
                        );

                    if (!removedProduct) {
                        throw reportWorkflowError(
                            'The related product listing could not be removed or was already removed.',
                            `/dashboard/admin/reports/${report._id}`
                        );
                    }

                    await recordStockMovement(
                        {
                            farmer: removedProduct.farmer,
                            product: removedProduct._id,
                            movementType: 'listing_removed',
                            quantityChange: 0,
                            quantityAfter: Number(
                                removedProduct.quantity || 0
                            ),
                            unit: removedProduct.unit,
                            note:
                                'Listing removed after admin report review.',
                            actorRole: 'admin',
                            createdBy: req.session.user.id
                        },
                        { session }
                    );

                    report.history.push({
                        action: 'Related product removed',
                        actor: req.session.user.id,
                        actorRole: 'admin',
                        note: 'Admin selected remove product.'
                    });
                }

                await report.save({ session });
            },
            TRANSACTION_OPTIONS
        );

        await runBestEffort(
            'Report audit logging failed',
            () =>
                recordAuditLog(req, {
                    action: 'report.updated',
                    targetType: 'Report',
                    target: report._id,
                    targetLabel:
                        report.targetSnapshot?.title ||
                        reasonLabel(report.reason),
                    category: 'report',
                    severity: ['resolved', 'rejected'].includes(
                        nextStatus
                    )
                        ? 'info'
                        : 'warning',
                    message:
                        `Admin changed report status from ` +
                        `${previousStatus} to ${nextStatus}.`,
                    metadata: {
                        previousStatus,
                        nextStatus,
                        adminAction,
                        reportedUser:
                            report.reportedUser?.toString?.() || ''
                    }
                })
        );

        await runBestEffort(
            'Reporter notification failed',
            () =>
                createNotification({
                    recipient: report.reporter,
                    actor: req.session.user.id,
                    actorRole: 'admin',
                    title: 'Report status updated',
                    message:
                        `Your report about ` +
                        `${report.targetSnapshot?.title || 'a marketplace record'} ` +
                        `is now ${nextStatus}.`,
                    link: `/dashboard/reports/${report._id}`
                })
        );

        if (
            adminAction === 'warned_user' &&
            report.reportedUser
        ) {
            await runBestEffort(
                'Reported-user warning notification failed',
                () =>
                    createNotification({
                        recipient: report.reportedUser,
                        actor: req.session.user.id,
                        actorRole: 'admin',
                        title: 'Marketplace report warning',
                        message:
                            adminNote ||
                            'An administrator reviewed a report involving your account. Please review marketplace rules and keep your listings and communication accurate.',
                        link: '/dashboard'
                    })
            );
        }

        req.session.success = 'Report updated.';

        return res.redirect(
            `/dashboard/admin/reports/${report._id}`
        );
    } catch (error) {
        const handled = redirectReportWorkflowError(
            req,
            res,
            error,
            '/dashboard/admin/reports'
        );

        if (handled) {
            return;
        }

        return next(error);
    }
}

function evidenceDownloadName(evidence) {
  return String(evidence.originalName || evidence.filename || 'report-evidence')
    .replace(/["\r\n]/g, '')
    .trim() || 'report-evidence';
}



async function sendReportEvidence(
    req,
    res,
    disposition,
    next
) {
    try {
        if (
            !isValidObjectId(req.params.id) ||
            !isValidObjectId(req.params.evidenceId)
        ) {
            req.session.error = 'Evidence not found.';

            return res.redirect(
                req.session.user.role === 'admin'
                    ? '/dashboard/admin/reports'
                    : '/dashboard/reports'
            );
        }

        const query = {
            _id: req.params.id
        };

        if (req.session.user.role !== 'admin') {
            query.reporter = req.session.user.id;
        }

        const report = await Report.findOne(
            query
        ).lean();

        const evidence =
            report?.evidence?.find(
                (item) =>
                    String(item._id) ===
                    String(req.params.evidenceId)
            );

        const absolutePath =
            resolveReportEvidencePath(evidence);

        if (!report || !absolutePath) {
            req.session.error = 'Evidence not found.';

            return res.redirect(
                req.session.user.role === 'admin'
                    ? '/dashboard/admin/reports'
                    : '/dashboard/reports'
            );
        }

        if (
            !isReportEvidencePathSafe(absolutePath)
        ) {
            await recordAuditLog(req, {
                action: 'report.evidence_blocked',
                targetType: 'Report',
                target: report._id,
                targetLabel:
                    report.targetSnapshot?.title ||
                    'Report evidence',
                category: 'security',
                severity: 'critical',
                message:
                    'Blocked unsafe report evidence path access.',
                metadata: {
                    evidenceId: req.params.evidenceId,
                    storageKey:
                        evidence.storageKey ||
                        evidence.filename ||
                        ''
                }
            });

            req.session.error =
                'Evidence access was blocked for security reasons.';

            return res.redirect(
                req.session.user.role === 'admin'
                    ? `/dashboard/admin/reports/${report._id}`
                    : `/dashboard/reports/${report._id}`
            );
        }

        try {
            await fs.access(absolutePath);
        } catch (fileError) {
            req.session.error =
                'The evidence file could not be found.';

            return res.redirect(
                req.session.user.role === 'admin'
                    ? `/dashboard/admin/reports/${report._id}`
                    : `/dashboard/reports/${report._id}`
            );
        }

        await recordAuditLog(req, {
            action:
                disposition === 'inline'
                    ? 'report.evidence_viewed'
                    : 'report.evidence_downloaded',
            targetType: 'Report',
            target: report._id,
            targetLabel:
                report.targetSnapshot?.title ||
                'Report evidence',
            category: 'report',
            severity: 'info',
            message:
                `Report evidence ${disposition === 'inline'
                    ? 'viewed online'
                    : 'downloaded'
                }.`,
            metadata: {
                evidenceId: req.params.evidenceId,
                filename: evidence.filename
            }
        });

        res.setHeader(
            'Content-Type',
            evidence.mimetype ||
            'application/octet-stream'
        );

        res.setHeader(
            'Content-Disposition',
            `${disposition}; filename="${evidenceDownloadName(
                evidence
            )}"`
        );

        res.setHeader(
            'X-Content-Type-Options',
            'nosniff'
        );

        res.setHeader(
            'Cache-Control',
            'private, no-store, max-age=0'
        );

        return res.sendFile(absolutePath);
    } catch (error) {
        return next(error);
    }
}

function viewEvidence(req, res, next) {
  return sendReportEvidence(req, res, 'inline', next);
}

function downloadEvidence(req, res, next) {
  return sendReportEvidence(req, res, 'attachment', next);
}

module.exports = {
  newReportForm,
  createReport,
  myReports,
  showReport,
  printReport,
  adminReports,
  adminReportsPrint,
  updateAdminReport,
  viewEvidence,
  downloadEvidence,
  reasonLabel,
  actionLabel
};
