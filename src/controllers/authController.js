const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { saveUserDocument, deleteUserDocument } = require('../services/userDocumentService');
const { createAdminNotifications } = require('../services/notificationService');
const { recordAuditLog } = require('../services/auditService');
const { sendPasswordResetEmail } = require('../services/emailService');
const config = require('../config/env');
const {
    getClientIp
} = require('../utils/requestIp');
const {
    logger
} = require('../services/loggerService');
const {
    recordAccountLockout,
    recordPasswordResetThrottled
} = require(
    '../services/operationalMonitoringService'
);

function allowedRole(role) {
  return ['farmer', 'buyer'].includes(role);
}


function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

const PASSWORD_RESET_MINUTES = Math.max(
    1,
    config.security.passwordResetWindowMinutes || 15
);

const PASSWORD_RESET_WINDOW_MS =
    PASSWORD_RESET_MINUTES * 60 * 1000;

const PASSWORD_RESET_ACCOUNT_MAX_REQUESTS = Math.max(
    1,
    config.security.passwordResetAccountMaxRequests || 3
);

const PASSWORD_RESET_MIN_RESPONSE_MS = 650;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function keepResponseTiming(startedAt, minimumMs = PASSWORD_RESET_MIN_RESPONSE_MS) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < minimumMs) {
    await delay(minimumMs - elapsed);
  }
}
async function runBestEffort(label, task) {
    try {
        return await task();
    } catch (error) {
        logger.error(
            label,
            {
                event: 'workflow.best_effort.failed',
                error
            }
        );
        return null;
    }
}
function createPasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function passwordResetExpiry() {
  return new Date(Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000);
}
async function reservePasswordResetRequest(userId) {
    const now = new Date();

    const windowCutoff = new Date(
        now.getTime() - PASSWORD_RESET_WINDOW_MS
    );

    const resetExpiredWindow = await User.updateOne(
        {
            _id: userId,
            $or: [
                {
                    'passwordResetThrottle.windowStartedAt': {
                        $exists: false
                    }
                },
                {
                    'passwordResetThrottle.windowStartedAt': null
                },
                {
                    'passwordResetThrottle.windowStartedAt': {
                        $lte: windowCutoff
                    }
                }
            ]
        },
        {
            $set: {
                'passwordResetThrottle.windowStartedAt': now,
                'passwordResetThrottle.requestCount': 1
            }
        }
    );

    if (resetExpiredWindow.modifiedCount === 1) {
        return true;
    }

    const incrementActiveWindow = await User.updateOne(
        {
            _id: userId,
            'passwordResetThrottle.windowStartedAt': {
                $gt: windowCutoff
            },
            $or: [
                {
                    'passwordResetThrottle.requestCount': {
                        $lt: PASSWORD_RESET_ACCOUNT_MAX_REQUESTS
                    }
                },
                {
                    'passwordResetThrottle.requestCount': {
                        $exists: false
                    }
                }
            ]
        },
        {
            $inc: {
                'passwordResetThrottle.requestCount': 1
            }
        }
    );

    return incrementActiveWindow.modifiedCount === 1;
}

function getBaseUrl(req) {
  if (config.appUrl) return config.appUrl.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function buildPasswordResetUrl(req, token) {
  return `${getBaseUrl(req)}/reset-password/${encodeURIComponent(token)}`;
}

function isValidResetTokenFormat(token) {
  return /^[a-f0-9]{64}$/i.test(String(token || ''));
}

async function findUserByValidResetToken(token) {
  if (!isValidResetTokenFormat(token)) return null;

  const tokenHash = hashPasswordResetToken(token);

  return User.findOne({
    'passwordReset.tokenHash': tokenHash,
    'passwordReset.expiresAt': { $gt: new Date() },
    accountStatus: { $ne: 'suspended' }
  }).select('+passwordHash +passwordReset.tokenHash +passwordReset.expiresAt');
}

function clearPasswordReset(user) {
  user.passwordReset = {
    tokenHash: '',
    expiresAt: null,
    requestedAt: null
  };
}

function lockoutExpiry(baseTime = Date.now()) {
    return new Date(
        baseTime +
        Math.max(1, config.security.loginLockoutMinutes) *
        60 *
        1000
    );
}

function isAccountLocked(user) {
  return Boolean(user?.loginSecurity?.lockedUntil && new Date(user.loginSecurity.lockedUntil).getTime() > Date.now());
}

function minutesUntilUnlock(user) {
  if (!user?.loginSecurity?.lockedUntil) return 0;
  return Math.max(1, Math.ceil((new Date(user.loginSecurity.lockedUntil).getTime() - Date.now()) / 60000));
}

async function recordLoginFailure(req, user, email, reason) {
  await recordAuditLog(req, {
    actor: user?._id || null,
    actorRole: user?.role || 'system',
    actorName: user?.name || '',
    actorEmail: user?.email || email,
    action: 'auth.login_failed',
    targetType: user ? 'User' : '',
    target: user?._id || null,
    targetLabel: user?.email || email,
    category: 'auth',
    severity: reason === 'account_locked' ? 'critical' : 'warning',
    message: reason === 'account_locked' ? 'Login blocked because account is temporarily locked.' : 'Failed login attempt.',
    metadata: { email, reason }
  });
}
async function incrementLoginFailure(userId) {
    const now = new Date();

    const lockedUntil =
        lockoutExpiry(now.getTime());

    const maxAttempts = Math.max(
        1,
        config.security.maxFailedLoginAttempts
    );

    const updatedUser = await User.findOneAndUpdate(
        { _id: userId },
        [
            {
                $set: {
                    'loginSecurity.failedLoginAttempts': {
                        $add: [
                            {
                                $ifNull: [
                                    '$loginSecurity.failedLoginAttempts',
                                    0
                                ]
                            },
                            1
                        ]
                    },
                    'loginSecurity.lastFailedLoginAt': now
                }
            },
            {
                $set: {
                    'loginSecurity.lockedUntil': {
                        $cond: [
                            {
                                $and: [
                                    {
                                        $gte: [
                                            '$loginSecurity.failedLoginAttempts',
                                            maxAttempts
                                        ]
                                    },
                                    {
                                        $or: [
                                            {
                                                $eq: [
                                                    {
                                                        $ifNull: [
                                                            '$loginSecurity.lockedUntil',
                                                            null
                                                        ]
                                                    },
                                                    null
                                                ]
                                            },
                                            {
                                                $lte: [
                                                    '$loginSecurity.lockedUntil',
                                                    now
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            },
                            lockedUntil,
                            '$loginSecurity.lockedUntil'
                        ]
                    }
                }
            }
        ],
        {
            returnDocument: 'after',
             updatePipeline: true
        }
    );

    const returnedLockedUntil =
        updatedUser?.loginSecurity?.lockedUntil;

    return {
        user: updatedUser,

        lockoutStarted: Boolean(
            returnedLockedUntil &&
            new Date(returnedLockedUntil).getTime() ===
            lockedUntil.getTime()
        )
    };
}

async function handleFailedLogin(
    req,
    user,
    email,
    reason = 'invalid_credentials'
) {
    if (!user) {
        await recordLoginFailure(
            req,
            null,
            email,
            reason
        );

        return;
    }

    const result =
        await incrementLoginFailure(user._id);

    const updatedUser = result.user;

    if (!updatedUser) {
        await recordLoginFailure(
            req,
            null,
            email,
            reason
        );

        return;
    }

    const attempts = Number(
        updatedUser.loginSecurity
            ?.failedLoginAttempts || 0
    );

    const accountLocked =
        isAccountLocked(updatedUser);

    await recordLoginFailure(
        req,
        updatedUser,
        email,
        accountLocked
            ? 'account_locked'
            : reason
    );

    if (result.lockoutStarted) {
        await recordAuditLog(req, {
            actor: updatedUser._id,
            actorRole: updatedUser.role,
            actorName: updatedUser.name,
            actorEmail: updatedUser.email,
            action: 'auth.account_locked',
            targetType: 'User',
            target: updatedUser._id,
            targetLabel: updatedUser.email,
            category: 'security',
            severity: 'critical',
            message:
                `Account temporarily locked after ${attempts} failed login attempts.`,
            metadata: {
                attempts,
                lockedUntil:
                    updatedUser.loginSecurity.lockedUntil
            }
        });
        recordAccountLockout({
            attempts,
            userId:
                updatedUser._id.toString()
        });
    }
   
}

async function markSuccessfulLogin(req, user) {
    const lastLoginIp =
        getClientIp(req);

    await User.updateOne(
        { _id: user._id },
        {
            $set: {
                'loginSecurity.failedLoginAttempts': 0,
                'loginSecurity.lockedUntil': null,
                'loginSecurity.lastLoginAt':
                    new Date(),
                'loginSecurity.lastLoginIp':
                    lastLoginIp
            }
        }
    );

    await recordAuditLog(req, {
    actor: user._id,
    actorRole: user.role,
    actorName: user.name,
    actorEmail: user.email,
    action: 'auth.login_success',
    targetType: 'User',
    target: user._id,
    targetLabel: user.email,
    category: 'auth',
    severity: 'info',
    message: 'User logged in successfully.'
  });
}

function roleAddressValue(role, body) {
  return normalizeText(role === 'farmer' ? body.farmAddress : body.deliveryAddress);
}

async function findSignupConflict(body) {
    const email = normalizeEmail(body.email);
    const phone = String(body.phone || '').trim();

    const conflict = await User.findOne({
        $or: [
            { email },
            { phone },
            { 'farmerProfile.phone': phone },
            { 'buyerProfile.phone': phone }
        ]
    })
        .select('email phone farmerProfile.phone buyerProfile.phone')
        .lean();

    if (!conflict) {
        return null;
    }

    if (conflict.email === email) {
        return 'An account already exists with this email address.';
    }

    return 'An account already exists with this phone number.';
}


function toSessionUser(user) {
    return {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus || 'active',
        authSessionVersion: Number(user.authSessionVersion || 0)
    };
}

function loginSession(req, user, next) {
  req.session.regenerate((error) => {
    if (error) return next(error);

    req.session.user = toSessionUser(user);
    if (user.role === 'admin') {
      req.session.adminReauthenticatedAt = Date.now();
    }
    req.session.success = `Welcome, ${user.name}.`;

    return req.session.save((saveError) => {
      if (saveError) return next(saveError);
      return next();
    });
  });
}

function showSignupOptions(req, res) {
  res.render('auth/signup-options', {
    title: 'Create your account'
  });
}

function showSignupForm(req, res) {
  const { role } = req.params;

  if (!allowedRole(role)) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  return res.render('auth/signup-form', {
    title: role === 'farmer' ? 'Farmer sign up' : 'Buyer sign up',
    role,
    formData: {},
    errors: []
  });
}


function getSignupDocumentFiles(req) {
    return {
        tinFile:
            req.files?.tinDocument?.[0] ||
            null,

        businessRegistrationFile:
            req.files
                ?.businessRegistrationCertificate?.[0] ||
            null
    };
}

function collectSignupErrors(req, result) {
    const errors = result.array();
    const {
        tinFile,
        businessRegistrationFile
    } = getSignupDocumentFiles(req);

    if (req.fileValidationError) {
        errors.push({
            msg: req.fileValidationError
        });
    }

    if (!tinFile) {
        errors.push({
            msg: 'TIN document upload is required.'
        });
    }

    if (!businessRegistrationFile) {
        errors.push({
            msg: 'Business registration certificate upload is required.'
        });
    }

    return errors;
}

function renderSignupForm(
    res,
    {
        status = 422,
        role,
        formData,
        errors
    }
) {
    return res.status(status).render(
        'auth/signup-form',
        {
            title:
                role === 'farmer'
                    ? 'Farmer sign up'
                    : 'Buyer sign up',
            role,
            formData,
            errors
        }
    );
}

async function notifyAdminsOfNewSignup(user) {
  const displayName = user.role === 'farmer'
    ? user.farmerProfile?.farmName || user.name
    : user.buyerProfile?.organization || user.name;

  await createAdminNotifications({
    actor: user._id,
    actorRole: user.role,
    title: `New ${user.role} awaiting approval`,
    message: `${displayName} signed up and is waiting for admin approval.`,
    link: `/dashboard/admin/users?q=${encodeURIComponent(user.email)}&status=pending_approval`
  });
}
function duplicateUserIdentityMessage(error) {
    if (error?.keyPattern?.email || error?.keyValue?.email) {
        return 'An account already exists with this email address.';
    }

    if (error?.keyPattern?.phone || error?.keyValue?.phone) {
        return 'An account already exists with this phone number.';
    }

    return 'An account already exists with this email address or phone number.';
}

async function signup(req, res, next) {
    let tinDocument = null;
    let businessRegistrationCertificate = null;

    try {
        const { role } = req.params;

        if (!allowedRole(role)) {
            return res.status(404).render(
                'errors/404',
                {
                    title: 'Page not found'
                }
            );
        }

        const result = validationResult(req);
        const formData = req.body;
        const signupErrors =
            collectSignupErrors(req, result);

        if (signupErrors.length) {
            return renderSignupForm(res, {
                role,
                formData,
                errors: signupErrors
            });
        }

        const signupConflictMessage =
            await findSignupConflict(req.body);

        if (signupConflictMessage) {
            return renderSignupForm(res, {
                status: 409,
                role,
                formData,
                errors: [
                    {
                        msg: signupConflictMessage
                    }
                ]
            });
        }

        const {
            tinFile,
            businessRegistrationFile
        } = getSignupDocumentFiles(req);

        try {
            tinDocument =
                await saveUserDocument(
                    tinFile,
                    'tin'
                );

            businessRegistrationCertificate =
                await saveUserDocument(
                    businessRegistrationFile,
                    'business-registration'
                );
        } catch (documentError) {
            await deleteUserDocument(tinDocument);
            await deleteUserDocument(
                businessRegistrationCertificate
            );

            return renderSignupForm(res, {
                role,
                formData,
                errors: [
                    {
                        msg:
                            documentError.message ||
                            'The verification documents could not be saved.'
                    }
                ]
            });
        }

        const passwordHash =
            await bcrypt.hash(
                req.body.password,
                12
            );

        const userPayload = {
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone,
            passwordHash,
            role,
            accountStatus: 'pending_approval',
            verificationDocuments: {
                tinDocument,
                businessRegistrationCertificate
            },
            documentReviewStatus: 'pending',
            documentReviewNote: ''
        };

        if (role === 'farmer') {
            userPayload.farmerProfile = {
                farmName: req.body.farmName,
                phone: req.body.phone,
                farmLocation: req.body.farmLocation,
                farmAddress:
                    roleAddressValue(role, req.body),
                mainProducts:
                    req.body.mainProducts
            };
        }

        if (role === 'buyer') {
            userPayload.buyerProfile = {
                organization:
                    req.body.organization,
                phone: req.body.phone,
                buyingLocation:
                    req.body.buyingLocation,
                deliveryAddress:
                    roleAddressValue(role, req.body),
                interestedProducts:
                    req.body.interestedProducts
            };
        }

        let user;

        try {
            user =
                await User.create(userPayload);
        } catch (createError) {
            await deleteUserDocument(tinDocument);
            await deleteUserDocument(
                businessRegistrationCertificate
            );

            if (createError.code === 11000) {
                return renderSignupForm(res, {
                    status: 409,
                    role,
                    formData,
                    errors: [
                        {
                            msg:
                                duplicateUserIdentityMessage(
                                    createError
                                )
                        }
                    ]
                });
            }

            throw createError;
        }

        await runBestEffort(
            'Admin signup notification failed',
            () => notifyAdminsOfNewSignup(user)
        );

        await runBestEffort(
            'Signup audit logging failed',
            () =>
                recordAuditLog(req, {
                    actor: user._id,
                    actorRole: user.role,
                    actorName: user.name,
                    actorEmail: user.email,
                    action: 'user.signup',
                    targetType: 'User',
                    target: user._id,
                    targetLabel: user.email,
                    message:
                        `${user.role} account submitted for approval.`,
                    metadata: {
                        role: user.role,
                        documentReviewStatus:
                            user.documentReviewStatus
                    }
                })
        );

        req.session.success =
            `Your ${role} account was created and is waiting for admin approval.`;

        return loginSession(
            req,
            user,
            (sessionError) => {
                if (sessionError) {
                    return next(sessionError);
                }

                return res.redirect('/dashboard');
            }
        );
    } catch (error) {
        await deleteUserDocument(tinDocument);
        await deleteUserDocument(
            businessRegistrationCertificate
        );

        return next(error);
    }
}

function showLogin(req, res) {
  res.render('auth/login', {
    title: 'Log in',
    formData: {},
    errors: []
  });
}

function showForgotPassword(req, res) {
  res.render('auth/forgot-password', {
    title: 'Forgot password',
    formData: {},
    errors: []
  });
}

async function requestPasswordReset(req, res, next) {
  const startedAt = Date.now();

  try {
    const result = validationResult(req);
    const email = normalizeEmail(req.body.email);
    const formData = { email };

    if (!result.isEmpty()) {
      return res.status(422).render('auth/forgot-password', {
        title: 'Forgot password',
        formData,
        errors: result.array()
      });
    }

    const user = await User.findOne({
      email,
      accountStatus: { $ne: 'suspended' }
    });

      if (user) {
          const requestReserved =
              await reservePasswordResetRequest(user._id);

          if (!requestReserved) {
              recordPasswordResetThrottled({
                  userId:
                      user._id.toString(),
                  windowMinutes:
                      PASSWORD_RESET_MINUTES,
                  maxRequests:
                      PASSWORD_RESET_ACCOUNT_MAX_REQUESTS
              });

              await runBestEffort(
                  'Password reset throttle audit logging failed',
                  () =>
                      recordAuditLog(req, {
                          actor:
                              user._id,
                          actorRole:
                              user.role,
                          actorName:
                              user.name,
                          actorEmail:
                              user.email,
                          action:
                              'auth.password_reset_throttled',
                          targetType:
                              'User',
                          target:
                              user._id,
                          targetLabel:
                              user.email,
                          category:
                              'security',
                          severity:
                              'warning',
                          message:
                              'Password reset request blocked by per-account throttling.',
                          metadata: {
                              windowMinutes:
                                  PASSWORD_RESET_MINUTES,
                              maxRequests:
                                  PASSWORD_RESET_ACCOUNT_MAX_REQUESTS
                          }
                      })
              );

              await keepResponseTiming(startedAt);

              return res.render(
                  'auth/forgot-password-submitted',
                  {
                      title: 'Password reset email sent'
                  }
              );
          }

          const token = createPasswordResetToken();

          user.passwordReset = {
        tokenHash: hashPasswordResetToken(token),
        expiresAt: passwordResetExpiry(),
        requestedAt: new Date()
      };

      await user.save();

      const resetUrl = buildPasswordResetUrl(req, token);

        try {
            await sendPasswordResetEmail({
                to: user.email,
                name: user.name,
                resetUrl,
                expiresMinutes: PASSWORD_RESET_MINUTES
            });

            await recordAuditLog(req, {
                actor: user._id,
                actorRole: user.role,
                actorName: user.name,
                actorEmail: user.email,
                action: 'auth.password_reset_requested',
                targetType: 'User',
                target: user._id,
                targetLabel: user.email,
                category: 'auth',
                severity: 'warning',
                message: 'Password reset email was requested and sent.'
            });
        } catch (emailError) {
            clearPasswordReset(user);
            await user.save();

            logger.error(
                'Password reset email failed.',
                {
                    event:
                        'auth.password_reset_email.failed',
                    error: emailError
                }
            );

            await runBestEffort(
                'Password reset email failure audit logging failed',
                () =>
                    recordAuditLog(req, {
                        actor: user._id,
                        actorRole: user.role,
                        actorName: user.name,
                        actorEmail: user.email,
                        action: 'auth.password_reset_email_failed',
                        targetType: 'User',
                        target: user._id,
                        targetLabel: user.email,
                        category: 'security',
                        severity: 'warning',
                        message:
                            'Password reset email could not be sent.'
                    })
            );
        }
    }

    await keepResponseTiming(startedAt);

    return res.render('auth/forgot-password-submitted', {
      title: 'Password reset email sent'
    });
  } catch (error) {
    return next(error);
  }
}

async function showResetPassword(req, res, next) {
  try {
    const token = String(req.params.token || '').trim();
    const user = await findUserByValidResetToken(token);

    if (!user) {
      return res.status(400).render('auth/reset-password', {
        title: 'Reset password',
        token: '',
        formData: {},
        errors: [{ msg: 'This password reset link is invalid or has expired. Please request a new link.' }],
        linkValid: false
      });
    }

    return res.render('auth/reset-password', {
      title: 'Reset password',
      token,
      formData: {},
      errors: [],
      linkValid: true
    });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const token = String(req.params.token || '').trim();
    const result = validationResult(req);
    const user = await findUserByValidResetToken(token);

    if (!user) {
      return res.status(400).render('auth/reset-password', {
        title: 'Reset password',
        token: '',
        formData: {},
        errors: [{ msg: 'This password reset link is invalid or has expired. Please request a new link.' }],
        linkValid: false
      });
    }

    if (!result.isEmpty()) {
      return res.status(422).render('auth/reset-password', {
        title: 'Reset password',
        token,
        formData: {},
        errors: result.array(),
        linkValid: true
      });
    }

      user.passwordHash = await bcrypt.hash(req.body.password, 12);
      clearPasswordReset(user);
      

      // Invalidate every older authenticated browser session.
      // Existing sessions keep their older version and will be rejected
      // on their next protected request.
      user.authSessionVersion = Number(user.authSessionVersion || 0) + 1;

      user.loginSecurity = user.loginSecurity || {};
      user.loginSecurity.failedLoginAttempts = 0;
      user.loginSecurity.lockedUntil = null;
      user.loginSecurity.lastFailedLoginAt = null;

      await user.save();

    await recordAuditLog(req, {
      actor: user._id,
      actorRole: user.role,
      actorName: user.name,
      actorEmail: user.email,
      action: 'auth.password_reset_completed',
      targetType: 'User',
      target: user._id,
      targetLabel: user.email,
      category: 'auth',
      severity: 'warning',
      message: 'User reset password using a valid email reset link.'
    });

      req.session.success =
          'Your password has been updated. Older login sessions have been signed out. Please log in with your new password.';

      return res.redirect('/login');
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const result = validationResult(req);
    const email = normalizeEmail(req.body.email);
    const formData = { email };

    if (!result.isEmpty()) {
      return res.status(422).render('auth/login', {
        title: 'Log in',
        formData,
        errors: result.array()
      });
    }

    const user = await User.findOne({ email }).select('+passwordHash');

    if (isAccountLocked(user)) {
      await recordLoginFailure(req, user, email, 'account_locked');
      return res.status(423).render('auth/login', {
        title: 'Log in',
        formData,
        errors: [{ msg: `This account is temporarily locked. Try again in about ${minutesUntilUnlock(user)} minute(s).` }]
      });
    }

    const passwordMatches = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;

    if (!user || !passwordMatches) {
      await handleFailedLogin(req, user, email);
      return res.status(401).render('auth/login', {
        title: 'Log in',
        formData,
        errors: [{ msg: 'Invalid email or password.' }]
      });
    }

    if (user.accountStatus === 'suspended') {
      await recordAuditLog(req, {
        actor: user._id,
        actorRole: user.role,
        actorName: user.name,
        actorEmail: user.email,
        action: 'auth.suspended_login_attempt',
        targetType: 'User',
        target: user._id,
        targetLabel: user.email,
        category: 'security',
        severity: 'warning',
        message: 'Suspended user attempted to log in.'
      });

      return res.status(403).render('auth/login', {
        title: 'Log in',
        formData,
        errors: [{ msg: 'This account has been suspended. Please contact support.' }]
      });
    }

    await markSuccessfulLogin(req, user);

    return loginSession(req, user, (sessionError) => {
      if (sessionError) return next(sessionError);
      return res.redirect('/dashboard');
    });
  } catch (error) {
    return next(error);
  }
}

function logout(req, res, next) {
  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie('agrolink.sid');
    return res.redirect('/');
  });
}

module.exports = {
  showSignupOptions,
  showSignupForm,
  signup,
  showLogin,
  showForgotPassword,
  requestPasswordReset,
  showResetPassword,
  resetPassword,
  login,
  logout
};
