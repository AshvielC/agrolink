const { body } = require('express-validator');

const contactFarmerRules = [
  body('subject')
    .trim()
    .isLength({ min: 4, max: 120 })
    .withMessage('Subject must be between 4 and 120 characters.'),
  body('message')
    .trim()
    .isLength({ min: 10, max: 1500 })
    .withMessage('Message must be between 10 and 1500 characters.'),
  body('buyerEmail')
    .trim()
    .isEmail()
    .withMessage('Enter a valid reply email address.')
    .bail()
    .normalizeEmail(),
  body('buyerPhone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 40 })
    .withMessage('Phone number must be 40 characters or fewer.')
];

module.exports = {
  contactFarmerRules
};
