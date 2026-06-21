const express = require('express');
const contactController = require('../controllers/contactController');
const { requireRole, requireApprovedFarmer, requireApprovedBuyer } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { contactFarmerRules } = require('../validators/contactValidators');

const router = express.Router();

router.get('/buyer/products/:productId/contact', requireRole('buyer'), requireApprovedBuyer, contactController.showContactFarmerForm);
router.post('/buyer/products/:productId/contact', requireRole('buyer'), requireApprovedBuyer, verifyCsrfToken, contactFarmerRules, contactController.sendContactFarmerMessage);
router.get('/farmer/messages', requireRole('farmer'), requireApprovedFarmer, contactController.farmerMessages);
router.get('/farmer/messages/:id', requireRole('farmer'), requireApprovedFarmer, contactController.showFarmerMessage);
router.get('/farmer/messages/:id/print', requireRole('farmer'), requireApprovedFarmer, contactController.printFarmerMessage);

module.exports = router;
