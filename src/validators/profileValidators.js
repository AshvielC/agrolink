const { body } = require('express-validator');

const commonNameRule = body('name')
  .trim()
  .isLength({ min: 2, max: 80 })
  .withMessage('Name must be between 2 and 80 characters.');

const optionalShortText = (field, label, max = 120) =>
  body(field)
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max })
    .withMessage(`${label} must be ${max} characters or fewer.`);
const requiredPhoneRule = () =>
    body('phone')
        .trim()
        .notEmpty()
        .withMessage('Phone number is required.')
        .bail()
        .matches(/^\d{7}$/)
        .withMessage(
            'Phone number must be exactly 7 digits. Do not include country code or spaces.'
        );

const farmerProfileRules = [
  commonNameRule,
  optionalShortText('farmName', 'Farm or business name'),
  optionalShortText('ownerName', 'Owner name'),
    requiredPhoneRule(),
  optionalShortText('farmLocation', 'Farm location'),
  optionalShortText('farmAddress', 'Farm address', 250),
  optionalShortText('mainProducts', 'Main products', 200),
  optionalShortText('pickupOptions', 'Pickup options', 300),
  optionalShortText('deliveryOptions', 'Delivery options', 300),
  optionalShortText('bankName', 'Bank name'),
  optionalShortText('bankAccountNumber', 'Bank account number', 80),
  optionalShortText('mpaisaNumber', 'M-PAiSA number', 40),
  optionalShortText('mycashNumber', 'MyCash number', 40),
  optionalShortText('farmDescription', 'Farm description', 600),
  body('removeProfileImage')
    .optional({ checkFalsy: true })
    .isIn(['1'])
    .withMessage('Invalid profile image removal option.')
];

const buyerProfileRules = [
  commonNameRule,
  optionalShortText('organization', 'Organization name'),
  optionalShortText('contactName', 'Contact name'),
    requiredPhoneRule(),
  optionalShortText('buyingLocation', 'Buying location'),
  optionalShortText('deliveryAddress', 'Delivery address', 250),
  optionalShortText('interestedProducts', 'Interested products', 200),
  optionalShortText('buyingNotes', 'Buying notes', 600),
  body('preferredContactMethod')
    .optional({ checkFalsy: true })
    .isIn(['email', 'phone', 'either'])
    .withMessage('Choose a valid preferred contact method.'),
  body('removeProfileImage')
    .optional({ checkFalsy: true })
    .isIn(['1'])
    .withMessage('Invalid profile image removal option.')
];

module.exports = {
  farmerProfileRules,
  buyerProfileRules
};
