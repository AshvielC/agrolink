const express = require('express');
const reportController = require('../controllers/reportController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { reportEvidenceUpload } = require('../middleware/reportEvidenceUpload');
const { reportRules, adminReportRules } = require('../validators/reportValidators');
const {
    requireFreshAdminSession,
    requireFreshAdminSessionFor
} = require('../middleware/adminReauth');
const {
    uploadIpLimiter,
    uploadAccountLimiter
} = require('../middleware/rateLimiters');

const router = express.Router();
router.post(
    '/reports',
    requireAuth,
    uploadIpLimiter,
    uploadAccountLimiter,
    reportEvidenceUpload,
    verifyCsrfToken,
    reportRules,
    reportController.createReport
);
router.get('/reports', requireAuth, reportController.myReports);
router.get('/reports/new', requireAuth, reportController.newReportForm);
router.get('/reports/:id', requireAuth, reportController.showReport);
router.get('/reports/:id/print', requireAuth, reportController.printReport);
router.get('/reports/:id/evidence/:evidenceId/view', requireAuth, reportController.viewEvidence);
router.get('/reports/:id/evidence/:evidenceId/download', requireAuth, reportController.downloadEvidence);
router.get(
    '/admin/reports',
    requireRole('admin'),
    requireFreshAdminSession,
    reportController.adminReports
);

router.get(
    '/admin/reports/print',
    requireRole('admin'),
    requireFreshAdminSession,
    reportController.adminReportsPrint
);

router.get(
    '/admin/reports/:id',
    requireRole('admin'),
    requireFreshAdminSession,
    reportController.showReport
);

router.get(
    '/admin/reports/:id/print',
    requireRole('admin'),
    requireFreshAdminSession,
    reportController.printReport
);

router.post(
    '/admin/reports/:id/status',
    requireRole('admin'),
    requireFreshAdminSessionFor(
        (req) => `/dashboard/admin/reports/${req.params.id}`
    ),
    verifyCsrfToken,
    adminReportRules,
    reportController.updateAdminReport
);

router.get(
    '/admin/reports/:id/evidence/:evidenceId/view',
    requireRole('admin'),
    requireFreshAdminSession,
    reportController.viewEvidence
);

router.get(
    '/admin/reports/:id/evidence/:evidenceId/download',
    requireRole('admin'),
    requireFreshAdminSession,
    reportController.downloadEvidence
);
module.exports = router;
