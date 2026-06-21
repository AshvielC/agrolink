const { Product } = require('../models/Product');
const { OrderRequest } = require('../models/OrderRequest');
const User = require('../models/User');
const { MAX_PRODUCTS_PER_FARMER } = require('../config/productLimits');

function dashboard(req, res) {
  if (req.session.user.role === 'admin') {
    return res.redirect('/dashboard/admin');
  }

  if (req.session.user.role === 'farmer') {
    return res.redirect('/dashboard/farmer');
  }

  return res.redirect('/dashboard/buyer');
}

async function farmerDashboard(req, res, next) {
  try {
    if (req.session.user.accountStatus !== 'active') {
      const farmer = await User.findById(req.session.user.id).lean();
      return res.render('dashboard/farmer-pending', {
        title: 'Farmer approval pending',
        user: farmer
      });
    }

    const farmerId = req.session.user.id;
    const [totalListings, activeListings, pendingRequests, acceptedRequests, recentProducts, recentRequests] = await Promise.all([
      Product.countDocuments({ farmer: farmerId, status: { $ne: 'removed' } }),
      Product.countDocuments({ farmer: farmerId, status: 'available', quantity: { $gt: 0 } }),
      OrderRequest.countDocuments({ farmer: farmerId, status: 'pending' }),
      OrderRequest.countDocuments({ farmer: farmerId, status: 'accepted' }),
      Product.find({ farmer: farmerId, status: { $ne: 'removed' } }).sort({ createdAt: -1 }).limit(4).lean(),
      OrderRequest.find({ farmer: farmerId })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean()
    ]);

    return res.render('dashboard/farmer', {
      title: 'Farmer dashboard',
      metrics: [
        { label: 'Active produce listings', value: activeListings },
        { label: 'Pending buyer requests', value: pendingRequests },
        { label: 'Active product slots used', value: `${totalListings}/${MAX_PRODUCTS_PER_FARMER}` }
      ],
      pendingRequests,
      acceptedRequests,
      recentProducts,
      recentRequests,
      productCount: totalListings,
      maxProductsPerFarmer: MAX_PRODUCTS_PER_FARMER
    });
  } catch (error) {
    return next(error);
  }
}

async function buyerDashboard(req, res, next) {
  try {
    if (req.session.user.accountStatus !== 'active') {
      const buyer = await User.findById(req.session.user.id).lean();
      return res.render('dashboard/buyer-pending', {
        title: 'Buyer approval pending',
        user: buyer
      });
    }

    const buyerId = req.session.user.id;
    const [allAvailableProducts, openRequests, recentRequests] = await Promise.all([
      Product.find({ status: 'available', removedAt: null, quantity: { $gt: 0 } })
        .populate('farmer', 'name accountStatus farmerProfile profileImage')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      OrderRequest.countDocuments({ buyer: buyerId, status: { $in: ['pending', 'accepted'] } }),
      OrderRequest.find({ buyer: buyerId })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean()
    ]);

    const activeProducts = allAvailableProducts.filter((product) => product.farmer && (product.farmer.accountStatus || 'active') === 'active');
    const activeFarmerIds = new Set(activeProducts.map((product) => product.farmer._id.toString()));

    return res.render('dashboard/buyer', {
      title: 'Buyer dashboard',
      metrics: [
        { label: 'Available listings', value: activeProducts.length },
        { label: 'Active farmers', value: activeFarmerIds.size },
        { label: 'Open requests', value: openRequests }
      ],
      recentProducts: activeProducts.slice(0, 6),
      recentRequests
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  dashboard,
  farmerDashboard,
  buyerDashboard
};
