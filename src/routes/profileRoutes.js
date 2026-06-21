const express = require('express');
const profileController = require('../controllers/profileController');
const { requireAuth, requireRole, requireApprovedFarmer } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { profileImageUpload } = require('../middleware/profileImageUpload');
const { farmerProfileRules, buyerProfileRules } = require('../validators/profileValidators');
const {
    uploadIpLimiter,
    uploadAccountLimiter
} = require('../middleware/rateLimiters');

const router = express.Router();

router.get('/profile', requireAuth, profileController.redirectMyProfile);

router.get('/farmer/profile', requireRole('farmer'), profileController.showFarmerProfile);
router.get('/farmer/profile/edit', requireRole('farmer'), profileController.editFarmerProfile);
router.post(
    '/farmer/profile',
    requireRole('farmer'),
    uploadIpLimiter,
    uploadAccountLimiter,
    profileImageUpload,
    verifyCsrfToken,
    farmerProfileRules,
    profileController.updateFarmerProfile
);
router.get('/buyer/profile', requireRole('buyer'), profileController.showBuyerProfile);
router.get('/buyer/profile/edit', requireRole('buyer'), profileController.editBuyerProfile);
router.post(
    '/buyer/profile',
    requireRole('buyer'),
    uploadIpLimiter,
    uploadAccountLimiter,
    profileImageUpload,
    verifyCsrfToken,
    buyerProfileRules,
    profileController.updateBuyerProfile
);
router.get('/buyer/farmers/:farmerId/profile', requireRole('buyer'), profileController.viewFarmerProfile);
router.get('/farmer/buyers/:buyerId/profile', requireRole('farmer'), requireApprovedFarmer, profileController.viewBuyerProfile);

module.exports = router;
