const express = require('express');
const productController = require('../controllers/productController');
const { requireRole, requireApprovedFarmer, requireApprovedBuyer } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { productImageUpload } = require('../middleware/productImageUpload');
const { productRules, buyerSearchRules } = require('../validators/productValidators');
const {
    uploadIpLimiter,
    uploadAccountLimiter
} = require('../middleware/rateLimiters');

const router = express.Router();

router.get('/farmer/products', requireRole('farmer'), requireApprovedFarmer, productController.farmerProducts);
router.get('/farmer/products/new', requireRole('farmer'), requireApprovedFarmer, productController.newProduct);
router.post(
    '/farmer/products',
    requireRole('farmer'),
    requireApprovedFarmer,
    uploadIpLimiter,
    uploadAccountLimiter,
    productImageUpload,
    verifyCsrfToken,
    productRules,
    productController.createProduct
);
router.get('/farmer/products/:id/stock-card', requireRole('farmer'), requireApprovedFarmer, productController.productStockCard);
router.get('/farmer/products/:id/edit', requireRole('farmer'), requireApprovedFarmer, productController.editProduct);
router.post(
    '/farmer/products/:id',
    requireRole('farmer'),
    requireApprovedFarmer,
    uploadIpLimiter,
    uploadAccountLimiter,
    productImageUpload,
    verifyCsrfToken,
    productRules,
    productController.updateProduct
); router.post('/farmer/products/:id/status', requireRole('farmer'), requireApprovedFarmer, verifyCsrfToken, productController.updateProductAvailability);
router.post('/farmer/products/:id/remove', requireRole('farmer'), requireApprovedFarmer, verifyCsrfToken, productController.removeProduct);
router.post('/farmer/products/:id/delete', requireRole('farmer'), requireApprovedFarmer, verifyCsrfToken, productController.removeProduct);

router.get('/buyer/marketplace', requireRole('buyer'), requireApprovedBuyer, buyerSearchRules, productController.buyerMarketplace);
router.get('/buyer/products/:id', requireRole('buyer'), requireApprovedBuyer, productController.buyerProductDetail);

module.exports = router;
