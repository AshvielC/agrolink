const express = require('express');
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');

const router = express.Router();

router.get('/notifications/count', requireAuth, notificationController.notificationCount);
router.get('/notifications', requireAuth, notificationController.listNotifications);
router.get('/notifications/:id', requireAuth, notificationController.showNotification);
router.post('/notifications/:id/read', requireAuth, verifyCsrfToken, notificationController.markNotificationRead);
router.post('/notifications/read-all', requireAuth, verifyCsrfToken, notificationController.markAllNotificationsRead);

module.exports = router;
