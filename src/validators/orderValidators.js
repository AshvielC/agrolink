const { body } = require('express-validator');
const { PAYMENT_METHODS, FULFILLMENT_METHODS } = require('../models/OrderRequest');

const orderRequestRules = [
  body('requestedQuantity')
    .trim()
    .notEmpty()
    .withMessage('Requested quantity is required.')
    .bail()
    .isFloat({ min: 0.01, max: 100000000 })
    .withMessage('Requested quantity must be greater than 0.'),
  body('buyerContactEmail')
    .trim()
    .isEmail()
    .withMessage('Enter a valid contact email address.')
    .bail()
    .normalizeEmail(),
  body('buyerContactPhone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 40 })
    .withMessage('Phone number must be 40 characters or fewer.'),
  body('deliveryNote')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 300 })
    .withMessage('Pickup or delivery note must be 300 characters or fewer.'),
  body('message')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 800 })
    .withMessage('Message must be 800 characters or fewer.')
];

const orderStatusRules = [
  body('status')
    .trim()
    .isIn(['accepted', 'rejected', 'cancelled'])
    .withMessage('Choose a valid request action.'),
  body('farmerResponse')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Response note must be 500 characters or fewer.')
];

const scheduleRequestRules = [
  body('method')
    .trim()
    .isIn(FULFILLMENT_METHODS)
    .withMessage('Choose pickup or delivery.'),
  body('requestedDate')
    .trim()
    .notEmpty()
    .withMessage('Preferred date is required.')
    .bail()
    .isISO8601({ strict: true, strictSeparator: false })
    .withMessage('Enter a valid preferred date.'),
  body('requestedTime')
    .trim()
    .notEmpty()
    .withMessage('Preferred time is required.')
    .bail()
    .isLength({ max: 80 })
    .withMessage('Preferred time must be 80 characters or fewer.'),
  body('location')
    .trim()
    .notEmpty()
    .withMessage('Pickup location or delivery address is required.')
    .bail()
    .isLength({ max: 220 })
    .withMessage('Location must be 220 characters or fewer.'),
  body('note')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Schedule note must be 500 characters or fewer.')
];

const farmerScheduleRules = [
  body('scheduleAction')
    .customSanitizer((value, { req }) => {
      if (value) return value;
      if (req.body.farmerProposedDate || req.body.farmerProposedTime || req.body.farmerProposedLocation) {
        return 'reschedule';
      }
      return '';
    })
    .trim()
    .isIn(['confirm', 'reschedule', 'complete', 'cancel_schedule'])
    .withMessage('Choose a valid schedule action.'),
  body('farmerProposedDate')
    .optional({ checkFalsy: true })
    .trim()
    .isISO8601({ strict: true, strictSeparator: false })
    .withMessage('Enter a valid proposed date.'),
  body('farmerProposedTime')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Proposed time must be 80 characters or fewer.'),
  body('farmerProposedLocation')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 220 })
    .withMessage('Proposed location must be 220 characters or fewer.'),
  body('farmerNote')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Schedule note must be 500 characters or fewer.')
];


const receiptIssueRules = [
  body('paymentMethod')
    .trim()
    .isIn(PAYMENT_METHODS)
    .withMessage('Choose a valid payment method.'),
  body('amountPaid')
    .trim()
    .notEmpty()
    .withMessage('Amount paid is required.')
    .bail()
    .isFloat({ min: 0.01, max: 100000000 })
    .withMessage('Amount paid must be greater than 0.'),
  body('paymentReference')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 120 })
    .withMessage('Payment reference must be 120 characters or fewer.'),
  body('receiptNote')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Receipt note must be 500 characters or fewer.')
];

module.exports = {
  orderRequestRules,
  orderStatusRules,
  scheduleRequestRules,
  farmerScheduleRules,
  receiptIssueRules
};
