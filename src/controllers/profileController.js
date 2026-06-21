const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { Product } = require('../models/Product');
const { OrderRequest } = require('../models/OrderRequest');
const { saveProfileImage, deleteProfileImage } = require('../services/profileImageService');
const { createAdminNotifications } = require('../services/notificationService');
const { recordAuditLog } = require('../services/auditService');

function isDuplicatePhoneError(error) {
    return (
        error?.code === 11000 &&
        Boolean(
            error?.keyPattern?.phone ||
            error?.keyValue?.phone
        )
    );
}
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
function normalizePhone(value) {
    return String(value || '').trim();
}

async function phoneBelongsToAnotherUser(phone, currentUserId) {
    if (!phone) {
        return false;
    }

    const conflict = await User.exists({
        _id: { $ne: currentUserId },
        $or: [
            { phone },
            { 'farmerProfile.phone': phone },
            { 'buyerProfile.phone': phone }
        ]
    });

    return Boolean(conflict);
}
function activeOrLegacyAccountFilter() {
  return {
    $or: [
      { accountStatus: 'active' },
      { accountStatus: { $exists: false } },
      { accountStatus: null },
      { accountStatus: '' }
    ]
  };
}

async function notifyAdminsOfProfileChange(user, role) {
  const displayName =
    role === 'farmer'
      ? user.farmerProfile?.farmName || user.name
      : user.buyerProfile?.organization || user.name;

  await createAdminNotifications({
    actor: user._id,
    actorRole: role,
    title: `${role === 'farmer' ? 'Farmer' : 'Buyer'} profile updated`,
    message: `${displayName} updated their ${role} profile.`,
    link: `/dashboard/admin/users?q=${encodeURIComponent(user.email)}`
  });
}

function redirectToRoleDashboard(req, fallback = '/dashboard') {
  if (req.session.user?.role === 'buyer') return '/dashboard/buyer';
  if (req.session.user?.role === 'farmer') return '/dashboard/farmer';
  if (req.session.user?.role === 'admin') return '/dashboard/admin';
  return fallback;
}

function emptyProfileImage() {
  return {
    filename: '',
    path: '',
    mimetype: '',
    size: 0,
    originalName: ''
  };
}

function farmerProfileFormData(user) {
  return {
    name: user?.name || '',
    farmName: user?.farmerProfile?.farmName || '',
    ownerName: user?.farmerProfile?.ownerName || '',
    phone: user?.farmerProfile?.phone || '',
    farmLocation: user?.farmerProfile?.farmLocation || '',
    farmAddress: user?.farmerProfile?.farmAddress || '',
    mainProducts: user?.farmerProfile?.mainProducts || '',
    pickupOptions: user?.farmerProfile?.pickupOptions || '',
    deliveryOptions: user?.farmerProfile?.deliveryOptions || '',
    bankName: user?.farmerProfile?.bankName || '',
    bankAccountNumber: user?.farmerProfile?.bankAccountNumber || '',
    mpaisaNumber: user?.farmerProfile?.mpaisaNumber || '',
    mycashNumber: user?.farmerProfile?.mycashNumber || '',
    farmDescription: user?.farmerProfile?.farmDescription || ''
  };
}

function buyerProfileFormData(user) {
  return {
    name: user?.name || '',
    organization: user?.buyerProfile?.organization || '',
    contactName: user?.buyerProfile?.contactName || '',
    phone: user?.buyerProfile?.phone || '',
    buyingLocation: user?.buyerProfile?.buyingLocation || '',
    deliveryAddress: user?.buyerProfile?.deliveryAddress || '',
    preferredContactMethod: user?.buyerProfile?.preferredContactMethod || 'email',
    interestedProducts: user?.buyerProfile?.interestedProducts || '',
    buyingNotes: user?.buyerProfile?.buyingNotes || ''
  };
}

function collectFormErrors(req) {
  const errors = validationResult(req).array();

  if (req.fileValidationError) {
    errors.push({ msg: req.fileValidationError });
  }

  return errors;
}

async function replaceProfileImage(user, req) {
  let nextImage = user.profileImage || emptyProfileImage();

  if (req.body.removeProfileImage === '1') {
    await deleteProfileImage(user.profileImage);
    nextImage = emptyProfileImage();
  }

  if (req.file) {
    const savedImage = await saveProfileImage(req.file);
    await deleteProfileImage(user.profileImage);
    nextImage = savedImage;
  }

  return nextImage;
}

function redirectMyProfile(req, res) {
  if (req.session.user.role === 'farmer') {
    return res.redirect('/dashboard/farmer/profile');
  }

  if (req.session.user.role === 'buyer') {
    return res.redirect('/dashboard/buyer/profile');
  }

  return res.redirect('/dashboard/admin');
}

async function showFarmerProfile(req, res, next) {
  try {
    const farmer = await User.findById(req.session.user.id).lean();

    return res.render('profiles/farmer-show', {
      title: 'My farmer profile',
      farmer,
      isOwner: true,
      products: [],
      orderStats: null
    });
  } catch (error) {
    return next(error);
  }
}

async function editFarmerProfile(req, res, next) {
  try {
    const farmer = await User.findById(req.session.user.id).lean();

    return res.render('profiles/farmer-edit', {
      title: 'Edit farmer profile',
      farmer,
      formData: farmerProfileFormData(farmer),
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

async function updateFarmerProfile(req, res, next) {
  try {
    const farmer = await User.findById(req.session.user.id);

    if (!farmer) {
      req.session.error = 'Your account could not be found. Please log in again.';
      return res.redirect('/login');
    }

    const errors = collectFormErrors(req);

    if (errors.length) {
      return res.status(422).render('profiles/farmer-edit', {
        title: 'Edit farmer profile',
        farmer,
        formData: { ...farmerProfileFormData(farmer), ...req.body },
        errors
      });
    }
      const phone = normalizePhone(req.body.phone);

      if (await phoneBelongsToAnotherUser(phone, farmer._id)) {
          return res.status(409).render('profiles/farmer-edit', {
              title: 'Edit farmer profile',
              farmer,
              formData: {
                  ...farmerProfileFormData(farmer),
                  ...req.body
              },
              errors: [
                  {
                      msg: 'An account already exists with this phone number.'
                  }
              ]
          });
      }


    let nextImage;

    try {
      nextImage = await replaceProfileImage(farmer, req);
    } catch (imageError) {
      return res.status(422).render('profiles/farmer-edit', {
        title: 'Edit farmer profile',
        farmer,
        formData: { ...farmerProfileFormData(farmer), ...req.body },
        errors: [{ msg: imageError.message }]
      });
    }

    farmer.name = req.body.name;
      farmer.phone = phone;
    farmer.profileImage = nextImage;
    farmer.farmerProfile = {
      farmName: req.body.farmName || '',
      ownerName: req.body.ownerName || '',
        phone,
      farmLocation: req.body.farmLocation || '',
      farmAddress: req.body.farmAddress || '',
      mainProducts: req.body.mainProducts || '',
      pickupOptions: req.body.pickupOptions || '',
      deliveryOptions: req.body.deliveryOptions || '',
      bankName: req.body.bankName || '',
      bankAccountNumber: req.body.bankAccountNumber || '',
      mpaisaNumber: req.body.mpaisaNumber || '',
      mycashNumber: req.body.mycashNumber || '',
      farmDescription: req.body.farmDescription || ''
    };

    await farmer.save();
    await notifyAdminsOfProfileChange(farmer, 'farmer');
    await recordAuditLog(req, {
      action: 'profile.updated',
      targetType: 'User',
      target: farmer._id,
      targetLabel: farmer.email,
      message: 'Farmer updated profile details.'
    });

    req.session.user.name = farmer.name;
    req.session.success = 'Farmer profile updated successfully.';
    return res.redirect('/dashboard/farmer/profile');
    } catch (error) {
        if (isDuplicatePhoneError(error)) {
            req.session.error =
                'An account already exists with this phone number.';

            return res.redirect('/dashboard/farmer/profile/edit');
        }

        return next(error);
    }
}

async function showBuyerProfile(req, res, next) {
  try {
    const buyer = await User.findById(req.session.user.id).lean();

    return res.render('profiles/buyer-show', {
      title: 'My buyer profile',
      buyer,
      isOwner: true,
      orderStats: null
    });
  } catch (error) {
    return next(error);
  }
}

async function editBuyerProfile(req, res, next) {
  try {
    const buyer = await User.findById(req.session.user.id).lean();

    return res.render('profiles/buyer-edit', {
      title: 'Edit buyer profile',
      buyer,
      formData: buyerProfileFormData(buyer),
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

async function updateBuyerProfile(req, res, next) {
  try {
    const buyer = await User.findById(req.session.user.id);

    if (!buyer) {
      req.session.error = 'Your account could not be found. Please log in again.';
      return res.redirect('/login');
    }

    const errors = collectFormErrors(req);

    if (errors.length) {
      return res.status(422).render('profiles/buyer-edit', {
        title: 'Edit buyer profile',
        buyer,
        formData: { ...buyerProfileFormData(buyer), ...req.body },
        errors
      });
    }
      const phone = normalizePhone(req.body.phone);

      if (await phoneBelongsToAnotherUser(phone, buyer._id)) {
          return res.status(409).render('profiles/buyer-edit', {
              title: 'Edit buyer profile',
              buyer,
              formData: {
                  ...buyerProfileFormData(buyer),
                  ...req.body
              },
              errors: [
                  {
                      msg: 'An account already exists with this phone number.'
                  }
              ]
          });
      }

    let nextImage;

    try {
      nextImage = await replaceProfileImage(buyer, req);
    } catch (imageError) {
      return res.status(422).render('profiles/buyer-edit', {
        title: 'Edit buyer profile',
        buyer,
        formData: { ...buyerProfileFormData(buyer), ...req.body },
        errors: [{ msg: imageError.message }]
      });
    }

    buyer.name = req.body.name;
      buyer.phone = phone;
    buyer.profileImage = nextImage;
    buyer.buyerProfile = {
      organization: req.body.organization || '',
      contactName: req.body.contactName || '',
        phone,
      buyingLocation: req.body.buyingLocation || '',
      deliveryAddress: req.body.deliveryAddress || '',
      preferredContactMethod: req.body.preferredContactMethod || 'email',
      interestedProducts: req.body.interestedProducts || '',
      buyingNotes: req.body.buyingNotes || ''
    };

    await buyer.save();
    await notifyAdminsOfProfileChange(buyer, 'buyer');
    await recordAuditLog(req, {
      action: 'profile.updated',
      targetType: 'User',
      target: buyer._id,
      targetLabel: buyer.email,
      message: 'Buyer updated profile details.'
    });

    req.session.user.name = buyer.name;
    req.session.success = 'Buyer profile updated successfully.';
    return res.redirect('/dashboard/buyer/profile');
    } catch (error) {
        if (isDuplicatePhoneError(error)) {
            req.session.error =
                'An account already exists with this phone number.';

            return res.redirect('/dashboard/buyer/profile/edit');
        }

        return next(error);
    }
}

async function viewFarmerProfile(req, res, next) {
  try {
    if (!isValidObjectId(req.params.farmerId)) {
      req.session.error = 'Farmer profile not found.';
      return res.redirect(redirectToRoleDashboard(req, '/dashboard/buyer'));
    }

    const farmer = await User.findOne({
      _id: req.params.farmerId,
      role: 'farmer',
      ...activeOrLegacyAccountFilter()
    }).lean();

    if (!farmer) {
      req.session.error = 'Farmer profile not found.';
      return res.redirect(redirectToRoleDashboard(req, '/dashboard/buyer'));
    }

    const products = await Product.find({
      farmer: farmer._id,
      status: 'available',
      removedAt: null,
      quantity: { $gt: 0 }
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    return res.render('profiles/farmer-show', {
      title: farmer.farmerProfile?.farmName || farmer.name,
      farmer,
      isOwner: false,
      products,
      orderStats: null
    });
  } catch (error) {
    return next(error);
  }
}

async function viewBuyerProfile(req, res, next) {
  try {
    if (!isValidObjectId(req.params.buyerId)) {
      req.session.error = 'Buyer profile not found.';
      return res.redirect(redirectToRoleDashboard(req, '/dashboard/farmer'));
    }

    const visibleOrder = await OrderRequest.findOne({
      buyer: req.params.buyerId,
      farmer: req.session.user.id
    }).lean();

    if (!visibleOrder) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }

    const buyer = await User.findOne({
      _id: req.params.buyerId,
      role: 'buyer',
      ...activeOrLegacyAccountFilter()
    }).lean();

    if (!buyer) {
      req.session.error = 'Buyer profile not found.';
      return res.redirect(redirectToRoleDashboard(req, '/dashboard/farmer'));
    }

    return res.render('profiles/buyer-show', {
      title: buyer.buyerProfile?.organization || buyer.name,
      buyer,
      isOwner: false,
      orderStats: null
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  redirectMyProfile,
  showFarmerProfile,
  editFarmerProfile,
  updateFarmerProfile,
  showBuyerProfile,
  editBuyerProfile,
  updateBuyerProfile,
  viewFarmerProfile,
  viewBuyerProfile
};
