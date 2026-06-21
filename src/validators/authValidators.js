const { body } = require('express-validator');

function requiredRoleField(fieldName, role, label, maxLength) {
  return body(fieldName)
    .if((value, { req }) => req.params.role === role)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required.`)
    .bail()
    .isLength({ max: maxLength })
    .withMessage(`${label} must be ${maxLength} characters or fewer.`);
}

const signupRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Full name is required.')
    .bail()
    .isLength({ min: 2, max: 80 })
    .withMessage('Name must be between 2 and 80 characters.'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email address is required.')
    .bail()
    .isEmail()
    .withMessage('Enter a valid email address.')
    .bail()
    .normalizeEmail(),
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required.')
    .bail()
    .matches(/^\d{7}$/)
    .withMessage('Phone number must be exactly 7 digits. Do not include country code or spaces.'),
  body('password')
    .notEmpty()
    .withMessage('Password is required.')
    .bail()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters.')
    .bail()
    .matches(/[A-Za-z]/)
    .withMessage('Password must include at least one letter.')
    .bail()
    .matches(/\d/)
    .withMessage('Password must include at least one number.'),
  body('confirmPassword')
    .notEmpty()
    .withMessage('Please confirm your password.')
    .bail()
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),
  requiredRoleField('farmName', 'farmer', 'Farm name', 120),
  requiredRoleField('farmLocation', 'farmer', 'Farm location', 120),
  requiredRoleField('farmAddress', 'farmer', 'Farm address', 250),
  requiredRoleField('mainProducts', 'farmer', 'Main products', 200),
  requiredRoleField('organization', 'buyer', 'Business or organization', 120),
  requiredRoleField('buyingLocation', 'buyer', 'Buying location', 120),
  requiredRoleField('deliveryAddress', 'buyer', 'Delivery address', 250),
  requiredRoleField('interestedProducts', 'buyer', 'Products you buy', 200)
];

const loginRules = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Enter a valid email address.')
    .bail()
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required.')
];

const forgotPasswordRules = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email address is required.')
    .bail()
    .isEmail()
    .withMessage('Enter a valid email address.')
    .bail()
    .normalizeEmail()
];

const resetPasswordRules = [
  body('password')
    .notEmpty()
    .withMessage('Password is required.')
    .bail()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters.')
    .bail()
    .matches(/[A-Za-z]/)
    .withMessage('Password must include at least one letter.')
    .bail()
    .matches(/\d/)
    .withMessage('Password must include at least one number.'),
  body('confirmPassword')
    .notEmpty()
    .withMessage('Please confirm your password.')
    .bail()
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match.');
      }
      return true;
    })
];

module.exports = {
  signupRules,
  loginRules,
  forgotPasswordRules,
  resetPasswordRules
};
