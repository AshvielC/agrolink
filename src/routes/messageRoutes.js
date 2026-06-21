const express = require('express');
const messageController = require('../controllers/messageController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { messageRules } = require('../validators/messageValidators');
const {
    requireFreshAdminSession
} = require('../middleware/adminReauth');

const router = express.Router();

router.get('/messages', requireAuth, messageController.listInbox);
router.get('/messages/sent', requireAuth, messageController.listSent);
router.get('/messages/compose/:userId', requireAuth, messageController.composeForm);
router.post('/messages/compose/:userId', requireAuth, verifyCsrfToken, messageRules, messageController.sendComposedMessage);
router.get('/messages/:id', requireAuth, messageController.showMessage);
router.get('/messages/:id/print', requireAuth, messageController.printMessage);
router.get('/messages/:id/reply', requireAuth, messageController.replyForm);
router.post('/messages/:id/reply', requireAuth, verifyCsrfToken, messageRules, messageController.sendReply);
router.post('/messages/:id/read', requireAuth, verifyCsrfToken, messageController.markRead);

router.get(
    '/admin/messages',
    requireRole('admin'),
    requireFreshAdminSession,
    messageController.adminMessages
);

router.get(
    '/admin/messages/print',
    requireRole('admin'),
    requireFreshAdminSession,
    messageController.adminMessagesPrint
);

module.exports = router;
