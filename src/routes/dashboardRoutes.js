const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, dashboardController.dashboard);
router.get('/farmer', requireRole('farmer'), dashboardController.farmerDashboard);
router.get('/buyer', requireRole('buyer'), dashboardController.buyerDashboard);

module.exports = router;
