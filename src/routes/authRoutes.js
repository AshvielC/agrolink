const express = require('express');
const authController = require('../controllers/authController');
const { signupRules, loginRules, forgotPasswordRules, resetPasswordRules } = require('../validators/authValidators');
const {
    attachCsrfToken,
    verifyCsrfToken
} = require('../middleware/csrf');
const { redirectIfAuthenticated } = require('../middleware/auth');
const {
    authLimiter,
    passwordResetLimiter,
    signupUploadLimiter
} = require('../middleware/rateLimiters');
const { signupDocumentUpload } = require('../middleware/signupDocumentUpload');

const router = express.Router();

router.get('/signup', redirectIfAuthenticated, authController.showSignupOptions);
router.get(
    '/signup/:role',
    redirectIfAuthenticated,
    attachCsrfToken,
    authController.showSignupForm
);
router.post(
    '/signup/:role',
    redirectIfAuthenticated,
    authLimiter,
    signupUploadLimiter,
    signupDocumentUpload,
    verifyCsrfToken,
    signupRules,
    authController.signup
);
router.get(
    '/login',
    redirectIfAuthenticated,
    attachCsrfToken,
    authController.showLogin
);
router.post('/login', redirectIfAuthenticated, authLimiter, verifyCsrfToken, loginRules, authController.login);

router.get(
    '/forgot-password',
    redirectIfAuthenticated,
    attachCsrfToken,
    authController.showForgotPassword
);
router.post('/forgot-password', redirectIfAuthenticated, passwordResetLimiter, verifyCsrfToken, forgotPasswordRules, authController.requestPasswordReset);
router.get(
    '/reset-password/:token',
    redirectIfAuthenticated,
    attachCsrfToken,
    authController.showResetPassword
);
router.post('/reset-password/:token', redirectIfAuthenticated, passwordResetLimiter, verifyCsrfToken, resetPasswordRules, authController.resetPassword);

router.post('/logout', verifyCsrfToken, authController.logout);

module.exports = router;
