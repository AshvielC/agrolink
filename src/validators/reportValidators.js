const { body } = require('express-validator');
const { REPORT_REASONS, REPORT_STATUSES, REPORT_ADMIN_ACTIONS } = require('../models/Report');

const reportRules = [
  body('reason')
    .isIn(REPORT_REASONS)
    .withMessage('Choose a valid report reason.'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Please describe the issue in 10 to 2000 characters.')
];

const adminReportRules = [
  body('status')
    .isIn(REPORT_STATUSES)
    .withMessage('Choose a valid report status.'),
  body('adminAction')
    .optional({ checkFalsy: true })
    .isIn(REPORT_ADMIN_ACTIONS)
    .withMessage('Choose a valid admin action.'),
  body('adminNote')
    .trim()
    .isLength({ max: 1200 })
    .withMessage('Admin note must be 1200 characters or fewer.'),
  body('resolutionNote')
    .trim()
    .isLength({ max: 1200 })
    .withMessage('Resolution note must be 1200 characters or fewer.')
];

module.exports = {
  reportRules,
  adminReportRules
};
