const express = require('express');
const orderController = require('../controllers/orderController');
const { requireRole, requireApprovedFarmer, requireApprovedBuyer } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { orderRequestRules, orderStatusRules, scheduleRequestRules, farmerScheduleRules, receiptIssueRules } = require('../validators/orderValidators');

const router = express.Router();

router.get('/buyer/orders', requireRole('buyer'), requireApprovedBuyer, orderController.buyerOrders);
router.get('/buyer/orders/history', requireRole('buyer'), requireApprovedBuyer, orderController.buyerOrderHistory);
router.get('/buyer/orders/:id/receipt', requireRole('buyer'), requireApprovedBuyer, orderController.viewBuyerReceipt);
router.get('/buyer/orders/:id', requireRole('buyer'), requireApprovedBuyer, orderController.showBuyerOrder);
router.get('/buyer/orders/:id/print', requireRole('buyer'), requireApprovedBuyer, orderController.printBuyerOrder);
router.get('/buyer/products/:productId/request', requireRole('buyer'), requireApprovedBuyer, orderController.requestProductForm);
router.post('/buyer/products/:productId/request', requireRole('buyer'), requireApprovedBuyer, verifyCsrfToken, orderRequestRules, orderController.createOrderRequest);
router.post('/buyer/orders/:id/cancel', requireRole('buyer'), requireApprovedBuyer, verifyCsrfToken, orderController.cancelBuyerOrder);
router.post('/buyer/orders/:id/schedule', requireRole('buyer'), requireApprovedBuyer, verifyCsrfToken, scheduleRequestRules, orderController.requestBuyerSchedule);
router.post('/buyer/orders/:id/schedule/confirm-proposal', requireRole('buyer'), requireApprovedBuyer, verifyCsrfToken, orderController.confirmBuyerScheduleProposal);

router.get('/farmer/orders', requireRole('farmer'), requireApprovedFarmer, orderController.farmerOrders);
router.get('/farmer/orders/history', requireRole('farmer'), requireApprovedFarmer, orderController.farmerOrderHistory);
router.get('/farmer/orders/:id/receipt', requireRole('farmer'), requireApprovedFarmer, orderController.viewFarmerReceipt);
router.get('/farmer/orders/:id', requireRole('farmer'), requireApprovedFarmer, orderController.showFarmerOrder);
router.get('/farmer/orders/:id/print', requireRole('farmer'), requireApprovedFarmer, orderController.printFarmerOrder);
router.post('/farmer/orders/:id/status', requireRole('farmer'), requireApprovedFarmer, verifyCsrfToken, orderStatusRules, orderController.updateFarmerOrderStatus);
router.post('/farmer/orders/:id/schedule', requireRole('farmer'), requireApprovedFarmer, verifyCsrfToken, farmerScheduleRules, orderController.updateFarmerSchedule);
router.post('/farmer/orders/:id/receipt/issue', requireRole('farmer'), requireApprovedFarmer, verifyCsrfToken, receiptIssueRules, orderController.issueFarmerReceipt);

module.exports = router;
