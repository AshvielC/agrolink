const { body } = require('express-validator');

const messageRules = [
  body('subject')
    .trim()
    .isLength({ min: 3, max: 140 })
    .withMessage('Subject must be between 3 and 140 characters.'),
  body('body')
    .trim()
    .isLength({ min: 2, max: 2500 })
    .withMessage('Message must be between 2 and 2500 characters.')
];

module.exports = {
  messageRules
};
