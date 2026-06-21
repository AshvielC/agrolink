const express = require('express');
const adminController = require('../controllers/adminController');
const exportController = require('../controllers/exportController');
const { requireRole } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const {
    requireFreshAdminSession,
    requireFreshAdminSessionFor
} = require('../middleware/adminReauth');
const { adminSensitiveLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.get('/admin', requireRole('admin'), adminController.dashboard);
router.get('/admin/reauth', requireRole('admin'), adminController.showAdminReauth);
router.post('/admin/reauth', requireRole('admin'), adminSensitiveLimiter, verifyCsrfToken, adminController.verifyAdminReauth);
router.get(
    '/admin/users',
    requireRole('admin'),
    requireFreshAdminSession,
    adminController.users
); router.get('/admin/audit', requireRole('admin'), requireFreshAdminSession, adminController.auditTrail);
router.get('/admin/security', requireRole('admin'), requireFreshAdminSession, adminController.securityDashboard);
router.get('/admin/exports', requireRole('admin'), requireFreshAdminSession, exportController.index);
router.get('/admin/exports/:dataset/csv', requireRole('admin'), requireFreshAdminSession, exportController.csv);
router.get('/admin/exports/:dataset/print', requireRole('admin'), requireFreshAdminSession, exportController.printView);
router.post(
    '/admin/security/users/:id/unlock',
    requireRole('admin'),
    requireFreshAdminSessionFor('/dashboard/admin/security'),
    verifyCsrfToken,
    adminController.unlockUserAccount
);
router.get('/admin/users/print', requireRole('admin'), requireFreshAdminSession, adminController.printUsersList);
router.get(
    '/admin/users/:id',
    requireRole('admin'),
    requireFreshAdminSession,
    adminController.getUserDetails
);
router.get('/admin/users/:id/print', requireRole('admin'), requireFreshAdminSession, adminController.printUserDetails);
router.get('/admin/users/:id/documents/:documentType/view', requireRole('admin'), requireFreshAdminSession, adminController.viewUserDocument);
router.get('/admin/users/:id/documents/:documentType/download', requireRole('admin'), requireFreshAdminSession, adminController.downloadUserDocument);
router.post(
    '/admin/users/:id/documents/:documentType/status',
    requireRole('admin'),
    requireFreshAdminSessionFor(
        (req) => `/dashboard/admin/users/${req.params.id}`
    ),
    verifyCsrfToken,
    adminController.updateUserDocumentStatus
);
router.post(
    '/admin/users/:id/status',
    requireRole('admin'),
    requireFreshAdminSessionFor(
        (req) => `/dashboard/admin/users/${req.params.id}`
    ),
    verifyCsrfToken,
    adminController.updateUserStatus
);
router.get(
    '/admin/products',
    requireRole('admin'),
    requireFreshAdminSession,
    adminController.products
);
router.post(
    '/admin/products/:id/remove',
    requireRole('admin'),
    requireFreshAdminSessionFor('/dashboard/admin/products'),
    verifyCsrfToken,
    adminController.removeProduct
);
router.get(
    '/admin/orders',
    requireRole('admin'),
    requireFreshAdminSession,
    adminController.orders
);
router.get(
    '/admin/orders/print',
    requireRole('admin'),
    requireFreshAdminSession,
    adminController.printOrders
);

router.get(
    '/admin/orders/:id',
    requireRole('admin'),
    requireFreshAdminSession,
    adminController.getOrderDetails
);

router.get(
    '/admin/orders/:id/print',
    requireRole('admin'),
    requireFreshAdminSession,
    adminController.printOrderDetails
);

module.exports = router;
