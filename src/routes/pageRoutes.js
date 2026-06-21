const express = require('express');
const pageController = require('../controllers/pageController');

const router = express.Router();

router.get('/', pageController.home);
router.get('/contact', pageController.contact);

module.exports = router;
