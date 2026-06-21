const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const {
  Product,
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  MANAGEABLE_PRODUCT_STATUSES,
  VAT_MODES
} = require('../models/Product');
const User = require('../models/User');
const { MAX_PRODUCTS_PER_FARMER } = require('../config/productLimits');
const { saveProductImage, deleteProductImage } = require('../services/productImageService');
const { recordAuditLog } = require('../services/auditService');
const StockMovement = require('../models/StockMovement');
const { recordStockMovement } = require('../services/stockMovementService');

const ACTIVE_FARMER_PRODUCT_QUERY = { status: { $ne: 'removed' } };
const TRANSACTION_OPTIONS = {
    readPreference: 'primary',
    writeConcern: { w: 'majority' }
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function farmerActiveProductFilter(farmerId) {
  return {
    farmer: farmerId,
    ...ACTIVE_FARMER_PRODUCT_QUERY
  };
}

function productFormOptions(extra = {}) {
  return {
    categories: PRODUCT_CATEGORIES,
    units: PRODUCT_UNITS,
    statuses: MANAGEABLE_PRODUCT_STATUSES,
    maxProductsPerFarmer: MAX_PRODUCTS_PER_FARMER,
    ...extra
  };
}

function normalizeProductStatus(status) {
  return MANAGEABLE_PRODUCT_STATUSES.includes(status) ? status : 'available';
}

function normalizeProductForm(body, existingProduct = {}) {
  return {
    _id: existingProduct._id,
    name: body.name || '',
    category: body.category || '',
    description: body.description || '',
    quantity: body.quantity || '',
    unit: body.unit || '',
    price: body.price || '',
    vatMode: body.vatMode || existingProduct.vatMode || 'none',
    vatRate: body.vatRate ?? existingProduct.vatRate ?? 0,
    location: body.location || '',
    harvestDate: body.harvestDate || '',
    status: normalizeProductStatus(body.status || existingProduct.status),
    image: existingProduct.image || {}
  };
}

function buildProductPayload(body) {
  const quantity = Number(body.quantity);
  const requestedStatus = normalizeProductStatus(body.status);

  return {
    name: body.name,
    category: body.category,
    description: body.description,
    quantity,
    unit: body.unit,
    price: body.price,
    vatMode: body.vatMode || 'none',
    vatRate: body.vatMode && body.vatMode !== 'none' ? Number(body.vatRate || 0) : 0,
    location: body.location,
    harvestDate: body.harvestDate || null,
    status: quantity > 0 ? requestedStatus : 'unavailable'
  };
}

function collectFormErrors(req) {
  const errors = validationResult(req).array();

  if (req.fileValidationError) {
    errors.push({ msg: req.fileValidationError });
  }

  return errors;
}

function emptyImage() {
  return {
    filename: '',
    path: '',
    mimetype: '',
    size: 0,
    originalName: ''
  };
}

function normalizeBuyerFilters(query) {
  return {
    q: query.q || '',
    category: query.category || '',
    location: query.location || '',
    farmer: query.farmer || '',
    minPrice: query.minPrice !== undefined ? query.minPrice : '',
    maxPrice: query.maxPrice !== undefined ? query.maxPrice : '',
    vatMode: query.vatMode || '',
    sort: query.sort || 'newest'
  };
}

function buildMarketplaceSort(sort) {
  const sortMap = {
    price_asc: { price: 1, createdAt: -1 },
    price_desc: { price: -1, createdAt: -1 },
    quantity_desc: { quantity: -1, createdAt: -1 },
    quantity_asc: { quantity: 1, createdAt: -1 },
    views_desc: { 'analytics.viewCount': -1, createdAt: -1 },
    requests_desc: { 'analytics.requestCount': -1, createdAt: -1 },
    newest: { createdAt: -1 }
  };

  return sortMap[sort] || sortMap.newest;
}

async function findActiveFarmersMatching(searchTerm) {
  if (!searchTerm) {
    return [];
  }

  const regex = new RegExp(escapeRegex(searchTerm), 'i');

  const farmers = await User.find({
    role: 'farmer',
    accountStatus: 'active',
    $or: [
      { name: regex },
      { email: regex },
      { 'farmerProfile.farmName': regex },
      { 'farmerProfile.farmLocation': regex }
    ]
  })
    .select('_id')
    .limit(80)
    .lean();

  return farmers.map((farmer) => farmer._id);
}

async function buildBuyerMarketplaceQuery(filters) {
  const query = { status: 'available', removedAt: null, quantity: { $gt: 0 } };

  if (filters.category) {
    query.category = filters.category;
  }

  if (filters.location) {
    query.location = new RegExp(escapeRegex(filters.location), 'i');
  }

  if (filters.vatMode) {
    query.vatMode = filters.vatMode;
  }

  const priceFilter = {};
  if (filters.minPrice !== '') priceFilter.$gte = Number(filters.minPrice);
  if (filters.maxPrice !== '') priceFilter.$lte = Number(filters.maxPrice);
  if (Object.keys(priceFilter).length) query.price = priceFilter;

  if (filters.farmer) {
    const farmerIds = await findActiveFarmersMatching(filters.farmer);
    query.farmer = farmerIds.length ? { $in: farmerIds } : { $in: [] };
  }

  if (filters.q) {
    const searchRegex = new RegExp(escapeRegex(filters.q), 'i');
    const qFarmerIds = await findActiveFarmersMatching(filters.q);
    query.$or = [
      { name: searchRegex },
      { description: searchRegex },
      { category: searchRegex },
      { location: searchRegex }
    ];

    if (qFarmerIds.length) {
      query.$or.push({ farmer: { $in: qFarmerIds } });
    }
  }

  return query;
}

function getSortOptions() {
  return [
    { value: 'newest', label: 'Newest first' },
    { value: 'price_asc', label: 'Lowest price' },
    { value: 'price_desc', label: 'Highest price' },
    { value: 'quantity_desc', label: 'Highest quantity' },
    { value: 'quantity_asc', label: 'Lowest quantity' },
    { value: 'views_desc', label: 'Most viewed' },
    { value: 'requests_desc', label: 'Most requested' }
  ];
}

async function countFarmerActiveProducts(farmerId) {
  return Product.countDocuments(farmerActiveProductFilter(farmerId));
}

async function findOwnedActiveProduct(
    productId,
    farmerId,
    session = null
) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return null;
    }

    const query = Product.findOne({
        _id: productId,
        farmer: farmerId,
        status: { $ne: 'removed' }
    });

    if (session) {
        query.session(session);
    }

    return query;
}

async function farmerProducts(req, res, next) {
  try {
    const products = await Product.find(farmerActiveProductFilter(req.session.user.id))
      .sort({ createdAt: -1 })
      .lean();

    return res.render('products/farmer-index', {
      title: 'My produce listings',
      products,
      productCount: products.length,
      maxProductsPerFarmer: MAX_PRODUCTS_PER_FARMER
    });
  } catch (error) {
    return next(error);
  }
}

async function newProduct(req, res, next) {
  try {
    const productCount = await countFarmerActiveProducts(req.session.user.id);

    if (productCount >= MAX_PRODUCTS_PER_FARMER) {
      req.session.error = `You can keep up to ${MAX_PRODUCTS_PER_FARMER} active product listings. Remove an old listing before adding another.`;
      return res.redirect('/dashboard/farmer/products');
    }

    return res.render('products/form', {
      title: 'Add produce listing',
      mode: 'create',
      formAction: '/dashboard/farmer/products',
      product: normalizeProductForm({}),
      errors: [],
      ...productFormOptions({ productCount })
    });
  } catch (error) {
    return next(error);
  }
}

async function createProduct(req, res, next) {
    try {
        const product = normalizeProductForm(req.body);

        const productCount =
            await countFarmerActiveProducts(
                req.session.user.id
            );

        const errors = collectFormErrors(req);

        if (productCount >= MAX_PRODUCTS_PER_FARMER) {
            errors.push({
                msg:
                    `You can keep up to ${MAX_PRODUCTS_PER_FARMER} ` +
                    'active product listings. Remove an old listing ' +
                    'before adding another.'
            });
        }

        if (errors.length) {
            return res.status(422).render('products/form', {
                title: 'Add produce listing',
                mode: 'create',
                formAction: '/dashboard/farmer/products',
                product,
                errors,
                ...productFormOptions({ productCount })
            });
        }

        let savedImage = null;

        try {
            savedImage = await saveProductImage(req.file);
        } catch (imageError) {
            return res.status(422).render('products/form', {
                title: 'Add produce listing',
                mode: 'create',
                formAction: '/dashboard/farmer/products',
                product,
                errors: [{ msg: imageError.message }],
                ...productFormOptions({ productCount })
            });
        }

        let createdProduct = null;

        try {
            await mongoose.connection.transaction(
                async (session) => {
                    const [newProduct] = await Product.create(
                        [
                            {
                                ...buildProductPayload(req.body),
                                removedAt: null,
                                image: savedImage || emptyImage(),
                                farmer: req.session.user.id
                            }
                        ],
                        { session }
                    );

                    createdProduct = newProduct;

                    await recordStockMovement(
                        {
                            farmer: req.session.user.id,
                            product: createdProduct._id,
                            movementType: 'listing_created',
                            quantityChange: createdProduct.quantity,
                            quantityAfter: createdProduct.quantity,
                            unit: createdProduct.unit,
                            note: 'Initial listing quantity.',
                            actorRole: 'farmer',
                            createdBy: req.session.user.id
                        },
                        { session }
                    );
                },
                TRANSACTION_OPTIONS
            );
        } catch (dbError) {
            // The image file is outside MongoDB and cannot be rolled
            // back automatically. Remove it if the DB transaction fails.
            await deleteProductImage(savedImage);

            throw dbError;
        }

        await recordAuditLog(req, {
            action: 'product.created',
            targetType: 'Product',
            target: createdProduct._id,
            targetLabel: createdProduct.name,
            message: 'Farmer created a product listing.',
            metadata: {
                status: createdProduct.status,
                quantity: createdProduct.quantity,
                unit: createdProduct.unit
            }
        });

        req.session.success =
            'Produce listing created successfully.';

        return res.redirect('/dashboard/farmer/products');
    } catch (error) {
        return next(error);
    }
}

async function editProduct(req, res, next) {
  try {
    const product = await findOwnedActiveProduct(req.params.id, req.session.user.id);

    if (!product) {
      return res.status(404).render('errors/404', { title: 'Listing not found' });
    }

    const productCount = await countFarmerActiveProducts(req.session.user.id);

    return res.render('products/form', {
      title: 'Edit produce listing',
      mode: 'edit',
      formAction: `/dashboard/farmer/products/${product._id}`,
      product,
      errors: [],
      ...productFormOptions({ productCount })
    });
  } catch (error) {
    return next(error);
  }
}

async function updateProduct(req, res, next) {
    try {
        const initialProduct =
            await findOwnedActiveProduct(
                req.params.id,
                req.session.user.id
            );

        if (!initialProduct) {
            return res.status(404).render('errors/404', {
                title: 'Listing not found'
            });
        }

        const productCount =
            await countFarmerActiveProducts(
                req.session.user.id
            );

        const formData = normalizeProductForm(
            req.body,
            initialProduct
        );

        const errors = collectFormErrors(req);

        if (errors.length) {
            return res.status(422).render('products/form', {
                title: 'Edit produce listing',
                mode: 'edit',
                formAction:
                    `/dashboard/farmer/products/${initialProduct._id}`,
                product: formData,
                errors,
                ...productFormOptions({ productCount })
            });
        }

        let replacementImage = null;

        if (req.file) {
            try {
                replacementImage =
                    await saveProductImage(req.file);
            } catch (imageError) {
                return res.status(422).render('products/form', {
                    title: 'Edit produce listing',
                    mode: 'edit',
                    formAction:
                        `/dashboard/farmer/products/${initialProduct._id}`,
                    product: formData,
                    errors: [{ msg: imageError.message }],
                    ...productFormOptions({ productCount })
                });
            }
        }

        let updatedProduct = null;
        let oldImage = null;

        try {
            await mongoose.connection.transaction(
                async (session) => {
                    const currentProduct =
                        await findOwnedActiveProduct(
                            req.params.id,
                            req.session.user.id,
                            session
                        );

                    if (!currentProduct) {
                        return;
                    }

                    oldImage =
                        currentProduct.image &&
                            currentProduct.image.filename
                            ? currentProduct.image.toObject?.() ||
                            currentProduct.image
                            : null;

                    const oldQuantity =
                        Number(currentProduct.quantity || 0);

                    currentProduct.set(
                        buildProductPayload(req.body)
                    );

                    currentProduct.removedAt = null;

                    if (replacementImage) {
                        currentProduct.image = replacementImage;
                    } else if (req.body.removeImage === 'on') {
                        currentProduct.image = emptyImage();
                    }

                    await currentProduct.save({ session });

                    const newQuantity =
                        Number(currentProduct.quantity || 0);

                    if (newQuantity !== oldQuantity) {
                        await recordStockMovement(
                            {
                                farmer: req.session.user.id,
                                product: currentProduct._id,
                                movementType: 'manual_adjustment',
                                quantityChange:
                                    newQuantity - oldQuantity,
                                quantityAfter: newQuantity,
                                unit: currentProduct.unit,
                                note:
                                    'Farmer updated product quantity manually.',
                                actorRole: 'farmer',
                                createdBy: req.session.user.id
                            },
                            { session }
                        );
                    }

                    updatedProduct = currentProduct;
                },
                TRANSACTION_OPTIONS
            );
        } catch (dbError) {
            // If the database update fails, remove a newly written
            // replacement image because it is not referenced by a product.
            await deleteProductImage(replacementImage);

            throw dbError;
        }

        if (!updatedProduct) {
            await deleteProductImage(replacementImage);

            return res.status(404).render('errors/404', {
                title: 'Listing not found'
            });
        }

        if (
            replacementImage ||
            req.body.removeImage === 'on'
        ) {
            // Delete the old image only after the MongoDB transaction
            // has committed successfully.
            await deleteProductImage(oldImage);
        }

        await recordAuditLog(req, {
            action: 'product.updated',
            targetType: 'Product',
            target: updatedProduct._id,
            targetLabel: updatedProduct.name,
            message: 'Farmer updated a product listing.',
            metadata: {
                status: updatedProduct.status,
                quantity: updatedProduct.quantity,
                unit: updatedProduct.unit
            }
        });

        req.session.success =
            'Produce listing updated successfully.';

        return res.redirect('/dashboard/farmer/products');
    } catch (error) {
        return next(error);
    }
}

async function updateProductAvailability(req, res, next) {
  try {
    const product = await findOwnedActiveProduct(req.params.id, req.session.user.id);

    if (!product) {
      req.session.error = 'Listing not found or already removed.';
      return res.redirect('/dashboard/farmer/products');
    }

    const nextStatus = normalizeProductStatus(req.body.status);

    if (nextStatus === 'available' && Number(product.quantity) <= 0) {
      req.session.error = 'Add quantity greater than 0 before marking this product available.';
      return res.redirect('/dashboard/farmer/products');
    }

    product.status = nextStatus;
    product.removedAt = null;
    await product.save();

    await recordAuditLog(req, {
      action: 'product.availability_updated',
      targetType: 'Product',
      target: product._id,
      targetLabel: product.name,
      message: `Farmer marked product as ${nextStatus}.`,
      metadata: { nextStatus }
    });

    req.session.success = nextStatus === 'available'
      ? 'Produce listing is now available to buyers.'
      : 'Produce listing is now marked as not available and hidden from the buyer marketplace.';

    return res.redirect('/dashboard/farmer/products');
  } catch (error) {
    return next(error);
  }
}

async function removeProduct(req, res, next) {
    try {
        let removedProduct = null;

        await mongoose.connection.transaction(
            async (session) => {
                const currentProduct =
                    await findOwnedActiveProduct(
                        req.params.id,
                        req.session.user.id,
                        session
                    );

                if (!currentProduct) {
                    return;
                }

                currentProduct.status = 'removed';
                currentProduct.removedAt = new Date();

                await currentProduct.save({ session });

                await recordStockMovement(
                    {
                        farmer: req.session.user.id,
                        product: currentProduct._id,
                        movementType: 'listing_removed',
                        quantityChange: 0,
                        quantityAfter:
                            Number(currentProduct.quantity || 0),
                        unit: currentProduct.unit,
                        note:
                            'Listing removed; existing order history preserved.',
                        actorRole: 'farmer',
                        createdBy: req.session.user.id
                    },
                    { session }
                );

                removedProduct = currentProduct;
            },
            TRANSACTION_OPTIONS
        );

        if (!removedProduct) {
            req.session.error =
                'Listing not found or already removed.';

            return res.redirect(
                '/dashboard/farmer/products'
            );
        }

        await recordAuditLog(req, {
            action: 'product.removed',
            targetType: 'Product',
            target: removedProduct._id,
            targetLabel: removedProduct.name,
            message: 'Farmer removed a product listing.',
            metadata: {
                removedAt: removedProduct.removedAt
            }
        });

        req.session.success =
            'Produce listing removed. Existing order records ' +
            'and history are preserved.';

        return res.redirect('/dashboard/farmer/products');
    } catch (error) {
        return next(error);
    }
}


async function buyerMarketplace(req, res, next) {
  try {
    const result = validationResult(req);
    const filters = normalizeBuyerFilters(req.query);
    let query = { status: 'available', removedAt: null, quantity: { $gt: 0 } };

    if (result.isEmpty()) {
      query = await buildBuyerMarketplaceQuery(filters);
    }

    const products = (await Product.find(query)
      .populate('farmer', 'name email accountStatus farmerProfile profileImage')
      .sort(buildMarketplaceSort(filters.sort))
      .limit(80)
      .lean())
      .filter((product) => product.farmer && (product.farmer.accountStatus || 'active') === 'active');

    return res.render('products/buyer-marketplace', {
      title: 'Browse produce',
      products,
      filters,
      categories: PRODUCT_CATEGORIES,
      vatModes: VAT_MODES,
      sortOptions: getSortOptions(),
      errors: result.array()
    });
  } catch (error) {
    return next(error);
  }
}

async function buyerProductDetail(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.session.error = 'Product listing not found.';
      return res.redirect('/dashboard/buyer/marketplace');
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, status: 'available', removedAt: null, quantity: { $gt: 0 } },
      { $inc: { 'analytics.viewCount': 1 } },
      { new: true, runValidators: true }
    )
      .populate('farmer', 'name email accountStatus farmerProfile profileImage')
      .lean();

    if (!product || !product.farmer || (product.farmer.accountStatus || 'active') !== 'active') {
      req.session.error = 'Product listing not found or no longer available.';
      return res.redirect('/dashboard/buyer/marketplace');
    }

    return res.render('products/buyer-detail', {
      title: product.name,
      product
    });
  } catch (error) {
    return next(error);
  }
}


async function productStockCard(req, res, next) {
  try {
    const product = await findOwnedActiveProduct(req.params.id, req.session.user.id);

    if (!product) {
      req.session.error = 'Listing not found or already removed.';
      return res.redirect('/dashboard/farmer/products');
    }

    const movements = await StockMovement.find({ farmer: req.session.user.id, product: product._id })
      .populate('order', 'productSnapshot requestedQuantity unit status paymentStatus receiptStatus fulfillment createdAt')
      .sort({ createdAt: 1 })
      .lean();

    return res.render('products/stock-card', {
      title: `Stock card: ${product.name}`,
      product,
      movements
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  farmerProducts,
  newProduct,
  createProduct,
  editProduct,
  updateProduct,
  updateProductAvailability,
  removeProduct,
  productStockCard,
  deleteProduct: removeProduct,
  buyerMarketplace,
  buyerProductDetail
};
