
const fs = require('fs/promises');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const { Product } = require('../models/Product');
const { OrderRequest, ORDER_STATUSES } = require('../models/OrderRequest');
const ContactMessage = require('../models/ContactMessage');
const AuditLog = require('../models/AuditLog');
const { Report } = require('../models/Report');
const { createNotification } = require('../services/notificationService');
const { recordAuditLog } = require('../services/auditService');
const {
    recordStockMovement
} = require('../services/stockMovementService');
const {
    resolveUserDocumentPath,
    isUserDocumentPathSafe
} = require('../services/userDocumentService');
const { safeReturnTo } = require('../middleware/adminReauth');
const {
    logger
} = require('../services/loggerService');
const USER_ROLES = ['buyer', 'farmer', 'admin'];
const ACCOUNT_STATUSES = ['active', 'pending_approval', 'suspended'];
const DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'];
const TRANSACTION_OPTIONS = {
    readPreference: 'primary',
    writeConcern: { w: 'majority' }
};
async function runBestEffort(label, task) {
    try {
        return await task();
    } catch (error) {
        logger.warn(
            'Best-effort admin side task failed.',
            {
                event: 'admin.best_effort.failed',
                label,
                error
            }
        );

        return null;
    }
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeStatus(status) {
  return ACCOUNT_STATUSES.includes(status) ? status : '';
}

function statusActionLabel(status) {
  const labels = {
    active: 'activated',
    pending_approval: 'moved to pending approval',
    suspended: 'suspended'
  };

  return labels[status] || 'updated';
}


function normalizeDocumentStatus(status) {
  return DOCUMENT_STATUSES.includes(status) ? status : '';
}

function documentLabel(documentType) {
  if (documentType === 'tin') return 'TIN document';
  if (documentType === 'business-registration') return 'Business registration certificate';
  return 'Verification document';
}

function getDocumentStatus(document = {}) {
  if (!document?.filename) return 'pending';
  return DOCUMENT_STATUSES.includes(document.status) ? document.status : 'pending';
}

function areUserDocumentsApproved(user) {
  const tinStatus = getDocumentStatus(user.verificationDocuments?.tinDocument);
  const businessStatus = getDocumentStatus(user.verificationDocuments?.businessRegistrationCertificate);
  return tinStatus === 'approved' && businessStatus === 'approved';
}

function updateOverallDocumentReviewStatus(user) {
  const tinStatus = getDocumentStatus(user.verificationDocuments?.tinDocument);
  const businessStatus = getDocumentStatus(user.verificationDocuments?.businessRegistrationCertificate);

  if (tinStatus === 'rejected' || businessStatus === 'rejected') {
    user.documentReviewStatus = 'rejected';
    const reasons = [];
    if (tinStatus === 'rejected') reasons.push(`TIN: ${user.verificationDocuments?.tinDocument?.rejectionReason || 'Rejected'}`);
    if (businessStatus === 'rejected') reasons.push(`Business registration: ${user.verificationDocuments?.businessRegistrationCertificate?.rejectionReason || 'Rejected'}`);
    user.documentReviewNote = reasons.join(' | ').slice(0, 400);
    return;
  }

  if (tinStatus === 'approved' && businessStatus === 'approved') {
    user.documentReviewStatus = 'approved';
    user.documentReviewNote = 'All verification documents approved.';
    return;
  }

  user.documentReviewStatus = 'pending';
  user.documentReviewNote = 'Verification documents are waiting for admin review.';
}

function regex(value) {
  const safe = String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(safe, 'i');
}


function showAdminReauth(req, res) {
  return res.render('admin/reauth', {
    title: 'Confirm admin access',
    returnTo: safeReturnTo(req.session.adminReturnTo || req.query.returnTo || '/dashboard/admin'),
    errors: []
  });
}

async function verifyAdminReauth(req, res, next) {
  try {
    const returnTo = safeReturnTo(req.body.returnTo || req.session.adminReturnTo || '/dashboard/admin');
    const password = String(req.body.password || '');
    const admin = await User.findById(req.session.user.id).select('+passwordHash');

    if (!admin || admin.role !== 'admin') {
      req.session.error = 'Admin account not found.';
      return res.redirect('/login');
    }

    const passwordMatches = password ? await bcrypt.compare(password, admin.passwordHash) : false;

    if (!passwordMatches) {
      await recordAuditLog(req, {
        actor: admin._id,
        actorRole: 'admin',
        actorName: admin.name,
        actorEmail: admin.email,
        action: 'auth.admin_reauth_failed',
        targetType: 'User',
        target: admin._id,
        targetLabel: admin.email,
        category: 'security',
        severity: 'critical',
        message: 'Admin re-authentication failed.'
      });

      return res.status(401).render('admin/reauth', {
        title: 'Confirm admin access',
        returnTo,
        errors: [{ msg: 'Invalid admin password.' }]
      });
    }

    req.session.adminReauthenticatedAt = Date.now();
    delete req.session.adminReturnTo;

    await recordAuditLog(req, {
      actor: admin._id,
      actorRole: 'admin',
      actorName: admin.name,
      actorEmail: admin.email,
      action: 'auth.admin_reauth_success',
      targetType: 'User',
      target: admin._id,
      targetLabel: admin.email,
      category: 'security',
      severity: 'info',
      message: 'Admin re-authenticated for sensitive access.'
    });

    return res.redirect(returnTo);
  } catch (error) {
    return next(error);
  }
}

function userListFilter(query) {
  const filter = {};

  if (USER_ROLES.includes(query.role)) {
    filter.role = query.role;
  }

  if (ACCOUNT_STATUSES.includes(query.status)) {
    filter.accountStatus = query.status;
  }

  if (query.q) {
    const searchRegex = regex(query.q);
    filter.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
      { 'farmerProfile.farmName': searchRegex },
      { 'farmerProfile.farmLocation': searchRegex },
      { 'buyerProfile.organization': searchRegex },
      { 'buyerProfile.buyingLocation': searchRegex }
    ];
  }

  if (query.location) {
    const locationRegex = regex(query.location);
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { 'farmerProfile.farmLocation': locationRegex },
        { 'farmerProfile.farmAddress': locationRegex },
        { 'buyerProfile.buyingLocation': locationRegex },
        { 'buyerProfile.deliveryAddress': locationRegex }
      ]
    });
  }

  if (DOCUMENT_STATUSES.includes(query.documentStatus)) {
    filter.documentReviewStatus = query.documentStatus;
  }

  return filter;
}

async function dashboard(req, res, next) {
  try {
      const now = new Date();

      const [
          totalUsers,
          pendingUsers,
          pendingFarmers,
          suspendedUsers,
          lockedAccounts,
          activeProducts,
          totalOrders,
          unreadMessages,
          recentUsers,
          recentOrders,
          recentLockedUsers,
          pendingDocuments,
          openReports,
          recentAuditLogs
      ] = await Promise.all([
          User.countDocuments({}),
          User.countDocuments({
              role: { $in: ['buyer', 'farmer'] },
              accountStatus: 'pending_approval'
          }),
          User.countDocuments({
              role: 'farmer',
              accountStatus: 'pending_approval'
          }),
          User.countDocuments({
              accountStatus: 'suspended'
          }),
          User.countDocuments({
              'loginSecurity.lockedUntil': {
                  $gt: now
              }
          }),
          Product.countDocuments({
              status: 'available',
              quantity: { $gt: 0 },
              removedAt: null
          }),
          OrderRequest.countDocuments({}),
          ContactMessage.countDocuments({}),
          User.find({})
              .sort({ createdAt: -1 })
              .limit(6)
              .lean(),
          OrderRequest.find({})
              .sort({ createdAt: -1 })
              .limit(6)
              .lean(),
          User.find({
              'loginSecurity.lockedUntil': {
                  $gt: now
              }
          })
              .select(
                  'name email role accountStatus loginSecurity'
              )
              .sort({
                  'loginSecurity.lockedUntil': -1
              })
              .limit(5)
              .lean(),
          User.countDocuments({
              role: { $in: ['buyer', 'farmer'] },
              documentReviewStatus: {
                  $in: ['pending', null, '']
              }
          }),
          Report.countDocuments({
              status: {
                  $in: ['open', 'under_review']
              }
          }),
          AuditLog.find({})
              .sort({ createdAt: -1 })
              .limit(8)
              .lean()
    ]);

    return res.render('admin/dashboard', {
      title: 'Admin dashboard',
      metrics: [
        { label: 'Total users', value: totalUsers },
        { label: 'Pending approvals', value: pendingUsers },
        { label: 'Pending farmers', value: pendingFarmers },
          { label: 'Suspended users', value: suspendedUsers },
          { label: 'Locked accounts', value: lockedAccounts },
        { label: 'Active listings', value: activeProducts },
        { label: 'Total orders', value: totalOrders },
        { label: 'Buyer messages', value: unreadMessages },
        { label: 'Documents pending review', value: pendingDocuments },
        { label: 'Open reports', value: openReports }
      ],
        recentUsers,
        recentOrders,
        recentLockedUsers,
        recentAuditLogs
    });
  } catch (error) {
    return next(error);
  }
}

async function users(req, res, next) {
  try {
    const filters = {
      role: req.query.role || '',
      status: req.query.status || '',
      q: req.query.q || '',
      location: req.query.location || '',
      documentStatus: req.query.documentStatus || ''
    };

    const usersList = await User.find(userListFilter(filters))
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.render('admin/users', {
      title: 'Manage users',
      users: usersList,
      filters,
      roles: USER_ROLES,
      statuses: ACCOUNT_STATUSES,
      documentStatuses: DOCUMENT_STATUSES
    });
  } catch (error) {
    return next(error);
  }
}

async function updateUserStatus(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    const nextStatus = normalizeStatus(req.body.accountStatus);

    if (!nextStatus) {
      req.session.error = 'Invalid account status.';
      return res.redirect('/dashboard/admin/users');
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    if (user._id.toString() === req.session.user.id && nextStatus === 'suspended') {
      req.session.error = 'You cannot suspend your own admin account.';
      return res.redirect('/dashboard/admin/users');
    }

    if (user.role === 'admin' && req.session.user.id !== user._id.toString()) {
      req.session.error = 'Admin accounts cannot be changed from this screen.';
      return res.redirect('/dashboard/admin/users');
    }

    updateOverallDocumentReviewStatus(user);

    if (nextStatus === 'active' && user.role !== 'admin' && !areUserDocumentsApproved(user)) {
      req.session.error = "Approve the user's TIN and business registration documents before activating the account.";
      return res.redirect(`/dashboard/admin/users/${user._id}`);
    }

    const previousStatus = user.accountStatus || 'pending_approval';
    user.accountStatus = nextStatus;
    user.statusNote = req.body.statusNote || '';

    if (nextStatus === 'active') {
      user.approvedAt = user.approvedAt || new Date();
      user.suspendedAt = null;
    }

    if (nextStatus === 'suspended') {
      user.suspendedAt = new Date();
    }

    await user.save();

    await recordAuditLog(req, {
      action: 'user.status_updated',
      targetType: 'User',
      target: user._id,
      targetLabel: user.email,
      message: `Account status changed from ${previousStatus} to ${nextStatus}.`,
      metadata: { previousStatus, nextStatus, statusNote: user.statusNote }
    });

    await createNotification({
      recipient: user._id,
      actor: req.session.user.id,
      actorRole: 'admin',
      title: 'Account status updated',
      message: `Your account was ${statusActionLabel(nextStatus)} by an administrator.`,
      link: '/dashboard'
    });

    req.session.success = `${user.name}'s account was ${statusActionLabel(nextStatus)}.`;
    return res.redirect('/dashboard/admin/users');
  } catch (error) {
    return next(error);
  }
}

async function products(req, res, next) {
  try {
    const filter = {};
    const filters = {
      status: req.query.status || '',
      q: req.query.q || '',
      location: req.query.location || ''
    };

    if (filters.status) {
      filter.status = filters.status;
    }

    if (filters.q) {
      const safe = filters.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: new RegExp(safe, 'i') },
        { category: new RegExp(safe, 'i') },
        { location: new RegExp(safe, 'i') }
      ];
    }

    const productsList = await Product.find(filter)
      .populate('farmer', 'name email accountStatus farmerProfile')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.render('admin/products', {
      title: 'Manage products',
      products: productsList,
      filters,
      statuses: ['available', 'unavailable', 'removed']
    });
  } catch (error) {
    return next(error);
  }
}

async function removeProduct(req, res, next) {
    try {
        if (!isValidObjectId(req.params.id)) {
            req.session.error = 'Product not found.';

            return res.redirect(
                '/dashboard/admin/products'
            );
        }

        let removedProduct = null;

        await mongoose.connection.transaction(
            async (session) => {
                removedProduct =
                    await Product.findOneAndUpdate(
                        {
                            _id: req.params.id,
                            status: { $ne: 'removed' }
                        },
                        {
                            $set: {
                                status: 'removed',
                                removedAt: new Date()
                            }
                        },
                        {
                            new: true,
                            runValidators: true,
                            session
                        }
                    );

                if (!removedProduct) {
                    return;
                }

                await recordStockMovement(
                    {
                        farmer: removedProduct.farmer,
                        product: removedProduct._id,
                        movementType: 'listing_removed',
                        quantityChange: 0,
                        quantityAfter: Number(
                            removedProduct.quantity || 0
                        ),
                        unit: removedProduct.unit,
                        note:
                            'Listing removed directly by an administrator; existing order history preserved.',
                        actorRole: 'admin',
                        createdBy: req.session.user.id
                    },
                    { session }
                );
            },
            TRANSACTION_OPTIONS
        );

        if (!removedProduct) {
            req.session.error =
                'Product not found or already removed.';

            return res.redirect(
                '/dashboard/admin/products'
            );
        }

        await runBestEffort(
            'Admin product-removal audit logging failed',
            () =>
                recordAuditLog(req, {
                    action: 'product.removed',
                    targetType: 'Product',
                    target: removedProduct._id,
                    targetLabel: removedProduct.name,
                    message: 'Product removed by admin.',
                    metadata: {
                        farmer:
                            removedProduct.farmer
                                ?.toString?.() ||
                            String(
                                removedProduct.farmer || ''
                            ),
                        removedAt: removedProduct.removedAt
                    }
                })
        );

        await runBestEffort(
            'Admin product-removal notification failed',
            () =>
                createNotification({
                    recipient: removedProduct.farmer,
                    actor: req.session.user.id,
                    actorRole: 'admin',
                    title: 'Product removed by admin',
                    message:
                        `Your product listing "${removedProduct.name}" ` +
                        'was removed by an administrator.',
                    link: '/dashboard/farmer/products'
                })
        );

        req.session.success =
            'Product listing removed. Order history was preserved.';

        return res.redirect(
            '/dashboard/admin/products'
        );
    } catch (error) {
        return next(error);
    }
}


async function getUserDetails(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    const user = await User.findById(req.params.id).lean();

    if (!user) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    const [productCount, orderCount, messageCount] = await Promise.all([
      user.role === 'farmer' ? Product.countDocuments({ farmer: user._id }) : 0,
      user.role === 'farmer'
        ? OrderRequest.countDocuments({ farmer: user._id })
        : user.role === 'buyer'
          ? OrderRequest.countDocuments({ buyer: user._id })
          : 0,
      user.role === 'farmer' ? ContactMessage.countDocuments({ farmer: user._id }) : 0
    ]);

    await recordAuditLog(req, {
      action: 'user.viewed',
      targetType: 'User',
      target: user._id,
      targetLabel: user.email,
      message: 'Admin viewed user details.'
    });

    return res.render('admin/user-show', {
      title: `User details: ${user.name}`,
      user,
      stats: { productCount, orderCount, messageCount },
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function printUserDetails(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    const user = await User.findById(req.params.id).lean();

    if (!user) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    const [productCount, orderCount, messageCount] = await Promise.all([
      user.role === 'farmer' ? Product.countDocuments({ farmer: user._id }) : 0,
      user.role === 'farmer'
        ? OrderRequest.countDocuments({ farmer: user._id })
        : user.role === 'buyer'
          ? OrderRequest.countDocuments({ buyer: user._id })
          : 0,
      user.role === 'farmer' ? ContactMessage.countDocuments({ farmer: user._id }) : 0
    ]);

    return res.render('admin/user-show', {
      title: `Print user details: ${user.name}`,
      user,
      stats: { productCount, orderCount, messageCount },
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}

async function printUsersList(req, res, next) {
  try {
    const filters = {
      role: req.query.role || '',
      status: req.query.status || '',
      q: req.query.q || '',
      location: req.query.location || '',
      documentStatus: req.query.documentStatus || ''
    };

    const usersList = await User.find(userListFilter(filters))
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.render('admin/users-print', {
      title: 'Print users list',
      users: usersList,
      filters,
      generatedAt: new Date()
    });
  } catch (error) {
    return next(error);
  }
}

function getDocumentKey(documentType) {
  if (documentType === 'tin') return 'tinDocument';
  if (documentType === 'business-registration') return 'businessRegistrationCertificate';
  return '';
}

function safeDownloadName(document) {
  return String(document.originalName || document.filename || 'verification-document')
    .replace(/["\r\n]/g, '')
    .trim() || 'verification-document';
}



async function sendUserDocument(
    req,
    res,
    disposition
) {
    if (!isValidObjectId(req.params.id)) {
        req.session.error = 'User not found.';

        return res.redirect(
            '/dashboard/admin/users'
        );
    }

    const docKey = getDocumentKey(
        req.params.documentType
    );

    if (!docKey) {
        req.session.error = 'Document not found.';

        return res.redirect(
            `/dashboard/admin/users/${req.params.id}`
        );
    }

    const user = await User.findById(
        req.params.id
    ).lean();

    const document =
        user?.verificationDocuments?.[docKey];

    const absolutePath =
        resolveUserDocumentPath(document);

    if (!user || !absolutePath) {
        req.session.error = 'Document not found.';

        return res.redirect(
            '/dashboard/admin/users'
        );
    }

    if (!isUserDocumentPathSafe(absolutePath)) {
        await recordAuditLog(req, {
            action: 'document.access_blocked',
            targetType: 'User',
            target: user._id,
            targetLabel: user.email,
            category: 'security',
            severity: 'critical',
            message:
                'Blocked unsafe verification document path access.',
            metadata: {
                documentType:
                    req.params.documentType,
                storageKey:
                    document.storageKey ||
                    document.filename ||
                    ''
            }
        });

        req.session.error =
            'Document access was blocked for security reasons.';

        return res.redirect(
            `/dashboard/admin/users/${user._id}`
        );
    }

    try {
        await fs.access(absolutePath);
    } catch (fileError) {
        await recordAuditLog(req, {
            action: 'document.file_missing',
            targetType: 'User',
            target: user._id,
            targetLabel: user.email,
            category: 'security',
            severity: 'warning',
            message:
                'Verification document record exists but the file could not be found.',
            metadata: {
                documentType:
                    req.params.documentType,
                storageKey:
                    document.storageKey ||
                    document.filename ||
                    ''
            }
        });

        req.session.error =
            'The verification document file could not be found.';

        return res.redirect(
            `/dashboard/admin/users/${user._id}`
        );
    }

    await recordAuditLog(req, {
        action:
            disposition === 'inline'
                ? 'document.viewed'
                : 'document.downloaded',
        targetType: 'User',
        target: user._id,
        targetLabel: user.email,
        category: 'document',
        severity: 'info',
        message:
            `${documentLabel(
                req.params.documentType
            )} ${disposition === 'inline'
                ? 'viewed online'
                : 'downloaded'
            } by admin.`,
        metadata: {
            documentType:
                req.params.documentType,
            filename: document.filename,
            storageKey:
                document.storageKey ||
                document.filename ||
                ''
        }
    });

    const filename =
        safeDownloadName(document);

    res.setHeader(
        'Content-Type',
        document.mimetype ||
        'application/octet-stream'
    );

    res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${filename}"`
    );

    res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
    );

    res.setHeader(
        'Cache-Control',
        'no-store'
    );

    return res.sendFile(absolutePath);
}

async function viewUserDocument(req, res, next) {
  try {
    return await sendUserDocument(req, res, 'inline');
  } catch (error) {
    return next(error);
  }
}

async function downloadUserDocument(req, res, next) {
  try {
    return await sendUserDocument(req, res, 'attachment');
  } catch (error) {
    return next(error);
  }
}


async function updateUserDocumentStatus(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    const docKey = getDocumentKey(req.params.documentType);
    const nextStatus = normalizeDocumentStatus(req.body.documentStatus);

    if (!docKey || !nextStatus) {
      req.session.error = 'Invalid document review action.';
      return res.redirect(`/dashboard/admin/users/${req.params.id}`);
    }

    const user = await User.findById(req.params.id);

    if (!user || user.role === 'admin') {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/users');
    }

    const document = user.verificationDocuments?.[docKey];

    if (!document?.filename) {
      req.session.error = 'That document has not been uploaded.';
      return res.redirect(`/dashboard/admin/users/${user._id}`);
    }

    const previousStatus = getDocumentStatus(document);
    const rejectionReason = String(req.body.rejectionReason || '').trim();

    if (nextStatus === 'rejected' && !rejectionReason) {
      req.session.error = 'A rejection reason is required when rejecting a document.';
      return res.redirect(`/dashboard/admin/users/${user._id}`);
    }

    document.status = nextStatus;
    document.reviewedAt = new Date();
    document.reviewedBy = req.session.user.id;
    document.rejectionReason = nextStatus === 'rejected' ? rejectionReason : '';

    updateOverallDocumentReviewStatus(user);

    if (nextStatus === 'rejected') {
      user.accountStatus = 'pending_approval';
      user.approvedAt = null;
    }

    await user.save();

    await recordAuditLog(req, {
      action: 'user.document_status_updated',
      targetType: 'User',
      target: user._id,
      targetLabel: user.email,
      message: `${documentLabel(req.params.documentType)} changed from ${previousStatus} to ${nextStatus}.`,
      metadata: {
        documentType: req.params.documentType,
        previousStatus,
        nextStatus,
        rejectionReason
      }
    });

    await createNotification({
      recipient: user._id,
      actor: req.session.user.id,
      actorRole: 'admin',
      title: `${documentLabel(req.params.documentType)} ${nextStatus}`,
      message: nextStatus === 'rejected'
        ? `${documentLabel(req.params.documentType)} was rejected. Reason: ${rejectionReason}`
        : `${documentLabel(req.params.documentType)} was marked as ${nextStatus}.`,
      link: '/dashboard'
    });

    req.session.success = `${documentLabel(req.params.documentType)} marked as ${nextStatus}.`;
    return res.redirect(`/dashboard/admin/users/${user._id}`);
  } catch (error) {
    return next(error);
  }
}

async function auditTrail(req, res, next) {
  try {
    const filters = {
      action: req.query.action || '',
      actorRole: req.query.actorRole || '',
      q: req.query.q || ''
    };

    const filter = {};

    if (filters.action) filter.action = filters.action;
    if (['buyer', 'farmer', 'admin', 'system'].includes(filters.actorRole)) filter.actorRole = filters.actorRole;

    if (filters.q) {
      const searchRegex = regex(filters.q);
      filter.$or = [
        { actorName: searchRegex },
        { actorEmail: searchRegex },
        { targetLabel: searchRegex },
        { message: searchRegex },
        { action: searchRegex }
      ];
    }

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.render('admin/audit', {
      title: 'Audit trail',
      logs,
      filters,
      actions: AuditLog.AUDIT_ACTIONS || []
    });
  } catch (error) {
    return next(error);
  }
}

function orderListFilter(filters) {
  const filter = {};

  if (ORDER_STATUSES.includes(filters.status)) {
    filter.status = filters.status;
  }

  if (filters.q) {
    const searchRegex = regex(filters.q);
    filter.$or = [
      { 'buyerSnapshot.name': searchRegex },
      { 'buyerSnapshot.email': searchRegex },
      { buyerContactEmail: searchRegex },
      { buyerContactPhone: searchRegex },
      { 'farmerSnapshot.name': searchRegex },
      { 'farmerSnapshot.email': searchRegex },
      { 'farmerSnapshot.farmName': searchRegex },
      { 'productSnapshot.name': searchRegex },
      { 'productSnapshot.location': searchRegex }
    ];
  }

  return filter;
}

async function orders(req, res, next) {
  try {
    const filters = {
      status: req.query.status || '',
      q: req.query.q || ''
    };

    const ordersList = await OrderRequest.find(orderListFilter(filters))
      .populate('buyer', 'name email buyerProfile')
      .populate('farmer', 'name email farmerProfile')
      .populate('product', 'name status')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.render('admin/orders', {
      title: 'Manage orders',
      orders: ordersList,
      filters,
      statuses: ORDER_STATUSES,
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function printOrders(req, res, next) {
  try {
    const filters = {
      status: req.query.status || '',
      q: req.query.q || ''
    };

    const ordersList = await OrderRequest.find(orderListFilter(filters))
      .populate('buyer', 'name email buyerProfile')
      .populate('farmer', 'name email farmerProfile')
      .populate('product', 'name status')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.render('admin/orders', {
      title: 'Print orders',
      orders: ordersList,
      filters,
      statuses: ORDER_STATUSES,
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}


async function getOrderDetails(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/admin/orders');
    }

    const order = await OrderRequest.findById(req.params.id)
      .populate('buyer', 'name email phone buyerProfile profileImage')
      .populate('farmer', 'name email phone farmerProfile profileImage')
      .populate('product', 'name status quantity unit')
      .lean();

    if (!order) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/admin/orders');
    }

    return res.render('admin/order-show', {
      title: `Order details: ${order.productSnapshot?.name || 'Order'}`,
      order,
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function printOrderDetails(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/admin/orders');
    }

    const order = await OrderRequest.findById(req.params.id)
      .populate('buyer', 'name email phone buyerProfile profileImage')
      .populate('farmer', 'name email phone farmerProfile profileImage')
      .populate('product', 'name status quantity unit')
      .lean();

    if (!order) {
      req.session.error = 'Order not found.';
      return res.redirect('/dashboard/admin/orders');
    }

    return res.render('admin/order-show', {
      title: `Print order details: ${order.productSnapshot?.name || 'Order'}`,
      order,
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}

async function securityDashboard(req, res, next) {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

      const [
          lockedAccounts,
          suspendedUsers,
          failedLogins24h,
          criticalSecurityEvents24h,
          documentAccess24h,
          blockedDocumentAccess24h,
          lockedUsers,
          recentSecurityLogs
      ] = await Promise.all([
      User.countDocuments({ 'loginSecurity.lockedUntil': { $gt: now } }),
      User.countDocuments({ accountStatus: 'suspended' }),
      AuditLog.countDocuments({ action: 'auth.login_failed', createdAt: { $gte: since24h } }),
      AuditLog.countDocuments({ severity: 'critical', createdAt: { $gte: since24h } }),
          AuditLog.countDocuments({ action: { $in: ['document.viewed', 'document.downloaded'] }, createdAt: { $gte: since24h } }),
          AuditLog.countDocuments({
              action: 'document.access_blocked',
              createdAt: {
                  $gte: since24h
              }
          }),
      User.find({ 'loginSecurity.lockedUntil': { $gt: now } })
        .select('name email role loginSecurity accountStatus')
        .sort({ 'loginSecurity.lockedUntil': -1 })
        .limit(50)
        .lean(),
      AuditLog.find({
        $or: [
          { category: { $in: ['auth', 'security', 'document'] } },
          { severity: { $in: ['warning', 'critical'] } }
        ]
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
    ]);

    await recordAuditLog(req, {
      action: 'security.dashboard_viewed',
      targetType: 'System',
      targetLabel: 'Security dashboard',
      category: 'security',
      severity: 'info',
      message: 'Admin viewed the security dashboard.'
    });

    return res.render('admin/security', {
      title: 'Security dashboard',
      metrics: [
        { label: 'Locked accounts', value: lockedAccounts },
        { label: 'Suspended users', value: suspendedUsers },
        { label: 'Failed logins, 24h', value: failedLogins24h },
        { label: 'Critical events, 24h', value: criticalSecurityEvents24h },
          {
              label: 'Document access, 24h',
              value: documentAccess24h
          },
          {
              label: 'Blocked document access, 24h',
              value: blockedDocumentAccess24h
          }
      ],
      lockedUsers,
      recentSecurityLogs
    });
  } catch (error) {
    return next(error);
  }
}

async function unlockUserAccount(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/security');
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      req.session.error = 'User not found.';
      return res.redirect('/dashboard/admin/security');
    }

    user.loginSecurity = user.loginSecurity || {};
    user.loginSecurity.failedLoginAttempts = 0;
    user.loginSecurity.lockedUntil = null;
    await user.save();

    await recordAuditLog(req, {
      action: 'auth.account_unlocked',
      targetType: 'User',
      target: user._id,
      targetLabel: user.email,
      category: 'security',
      severity: 'warning',
      message: 'Admin manually unlocked a temporarily locked account.'
    });

    await createNotification({
      recipient: user._id,
      actor: req.session.user.id,
      actorRole: 'admin',
      title: 'Account unlocked',
      message: 'An administrator unlocked your account. You can try signing in again.',
      link: '/login'
    });

    req.session.success = `${user.name}'s login lock was cleared.`;
    return res.redirect('/dashboard/admin/security');
  } catch (error) {
    return next(error);
  }
}


module.exports = {
  showAdminReauth,
  verifyAdminReauth,
  dashboard,
  users,
  getUserDetails,
  printUserDetails,
  printUsersList,
  viewUserDocument,
  downloadUserDocument,
  updateUserDocumentStatus,
  updateUserStatus,
  products,
  removeProduct,
  orders,
  printOrders,
  getOrderDetails,
  printOrderDetails,
  auditTrail,
  securityDashboard,
  unlockUserAccount
};
