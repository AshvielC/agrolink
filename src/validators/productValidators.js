const { body, query } = require('express-validator');
const { PRODUCT_CATEGORIES, PRODUCT_UNITS, MANAGEABLE_PRODUCT_STATUSES } = require('../models/Product');

const trimOptional = { checkFalsy: true };

const productRules = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 90 })
    .withMessage('Product name must be between 2 and 90 characters.'),
  body('category')
    .isIn(PRODUCT_CATEGORIES)
    .withMessage('Choose a valid product category.'),
  body('description')
    .optional(trimOptional)
    .trim()
    .isLength({ max: 600 })
    .withMessage('Description must be 600 characters or less.'),
  body('quantity')
    .toFloat()
    .isFloat({ min: 0.01, max: 100000000 })
    .withMessage('Quantity must be a positive number.'),
  body('unit')
    .isIn(PRODUCT_UNITS)
    .withMessage('Choose a valid unit.'),
  body('price')
    .toFloat()
    .isFloat({ min: 0.01, max: 100000000 })
    .withMessage('Price must be a positive number.'),
  body('vatMode')
    .optional(trimOptional)
    .isIn(['none', 'inclusive', 'exclusive'])
    .withMessage('Choose whether the listed price is VAT inclusive, VAT exclusive, or has no VAT.'),
  body('vatRate')
    .optional(trimOptional)
    .toFloat()
    .isFloat({ min: 0, max: 100 })
    .withMessage('VAT rate must be between 0 and 100.'),
  body('location')
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Location must be between 2 and 120 characters.'),
  body('harvestDate')
    .optional(trimOptional)
    .isISO8601()
    .withMessage('Harvest date must be a valid date.')
    .toDate(),
  body('status')
    .optional(trimOptional)
    .isIn(MANAGEABLE_PRODUCT_STATUSES)
    .withMessage('Choose a valid product status.')
];

const buyerSearchRules = [
  query('q').optional(trimOptional).trim().isLength({ max: 80 }).withMessage('Search text is too long.'),
  query('category').optional(trimOptional).isIn(PRODUCT_CATEGORIES).withMessage('Choose a valid category.'),
  query('location').optional(trimOptional).trim().isLength({ max: 80 }).withMessage('Location search is too long.'),
  query('farmer').optional(trimOptional).trim().isLength({ max: 80 }).withMessage('Farmer or farm name search is too long.'),
  query('minPrice').optional(trimOptional).toFloat().isFloat({ min: 0, max: 100000000 }).withMessage('Minimum price must be a positive number.'),
  query('maxPrice').optional(trimOptional).toFloat().isFloat({ min: 0, max: 100000000 }).withMessage('Maximum price must be a positive number.'),
  query('vatMode').optional(trimOptional).isIn(['none', 'inclusive', 'exclusive']).withMessage('Choose a valid VAT filter.'),
  query('sort').optional(trimOptional).isIn(['newest', 'price_asc', 'price_desc', 'quantity_desc', 'quantity_asc', 'views_desc', 'requests_desc']).withMessage('Choose a valid sort option.')
];

module.exports = {
  productRules,
  buyerSearchRules
};
