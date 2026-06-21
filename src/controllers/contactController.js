const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const { Product } = require('../models/Product');
const User = require('../models/User');
const ContactMessage = require('../models/ContactMessage');
const { createUserMessage } = require('../services/messageService');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeContactForm(body = {}, fallbackEmail = '') {
    return {
        subject: String(body.subject || '').trim(),
        message: String(body.message || '').trim(),
        buyerEmail: String(body.buyerEmail || fallbackEmail || '').trim().toLowerCase(),
        buyerPhone: String(body.buyerPhone || '').trim()
    };
}

async function findContactableProduct(productId) {
    if (!isValidObjectId(productId)) {
        return null;
    }

    const product = await Product.findOne({
        _id: productId,
        status: 'available',
        removedAt: null,
        quantity: { $gt: 0 }
    })
        .populate('farmer', 'name email role accountStatus farmerProfile profileImage')
        .lean();

    if (!product || !product.farmer) {
        return null;
    }

    if (product.farmer.role !== 'farmer') {
        return null;
    }

    if ((product.farmer.accountStatus || 'active') !== 'active') {
        return null;
    }

    return product;
}

async function showContactFarmerForm(req, res, next) {
  try {
    const product = await findContactableProduct(req.params.productId);

    if (!product) {
      req.session.error = 'That product is no longer available for contact.';
      return res.redirect('/dashboard/buyer/marketplace');
    }

    const buyer = await User.findById(req.session.user.id).lean();

    return res.render('contacts/farmer-form', {
      title: `Contact farmer about ${product.name}`,
      product,
      formData: normalizeContactForm(
        {
          subject: `Enquiry about ${product.name}`,
          message: '',
          buyerPhone: buyer?.buyerProfile?.phone || ''
        },
        buyer?.email || req.session.user.email
      ),
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

async function sendContactFarmerMessage(req, res, next) {
  try {
    const product = await findContactableProduct(req.params.productId);

    if (!product) {
      req.session.error = 'That product is no longer available for contact.';
      return res.redirect('/dashboard/buyer/marketplace');
    }

    const result = validationResult(req);
    const formData = normalizeContactForm(req.body, req.session.user.email);

    if (!result.isEmpty()) {
      return res.status(422).render('contacts/farmer-form', {
        title: `Contact farmer about ${product.name}`,
        product,
        formData,
        errors: result.array()
      });
    }

    const buyer = await User.findById(req.session.user.id).lean();
    const buyerName = buyer?.name || req.session.user.name;

    const contactMessage = await ContactMessage.create({
      buyer: req.session.user.id,
      farmer: product.farmer._id,
      product: product._id,
      subject: formData.subject,
      message: formData.message,
      buyerEmail: formData.buyerEmail,
      buyerPhone: formData.buyerPhone,
      productSnapshot: {
        name: product.name,
        category: product.category,
        price: product.price,
        currency: product.currency,
        location: product.location
      },
      buyerSnapshot: {
        name: buyer?.buyerProfile?.organization || buyer?.buyerProfile?.contactName || buyerName,
        email: buyer?.email || req.session.user.email
      },
      farmerSnapshot: {
        name: product.farmer?.name || '',
        email: product.farmer?.email || '',
        farmName: product.farmer?.farmerProfile?.farmName || ''
      }
    });

    try {
      const appMessage = await createUserMessage({
        senderId: req.session.user.id,
        recipientId: product.farmer._id,
        subject: formData.subject,
        body: formData.message,
        messageType: 'product_enquiry',
        relatedProduct: product._id,
        productSnapshot: {
          name: product.name,
          category: product.category,
          location: product.location
        }
      });

      contactMessage.emailStatus = 'skipped';
      contactMessage.emailError = '';
    } catch (messageError) {
      contactMessage.emailStatus = 'failed';
      contactMessage.emailError = messageError.message || 'Message could not be sent.';
    }

    await contactMessage.save();

    await Product.updateOne(
      { _id: product._id },
      { $inc: { 'analytics.contactCount': 1 } }
    );

    if (contactMessage.emailStatus === 'failed') {
      req.session.error = 'Your message was saved, but the in-app message could not be created. Please try again from the message center.';
    } else {
      req.session.success = 'Your message was sent in the app and the farmer was notified.';
    }

    return res.redirect('/dashboard/buyer/marketplace');
  } catch (error) {
    return next(error);
  }
}

async function farmerMessages(req, res, next) {
  try {
    const messages = await ContactMessage.find({ farmer: req.session.user.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.render('contacts/farmer-messages', {
      title: 'Buyer contact messages',
      messages
    });
  } catch (error) {
    return next(error);
  }
}


async function showFarmerMessage(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/farmer/messages');
    }

    const message = await ContactMessage.findOne({ _id: req.params.id, farmer: req.session.user.id }).lean();

    if (!message) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/farmer/messages');
    }

    return res.render('contacts/message-print', {
      title: message.subject,
      message,
      printMode: false
    });
  } catch (error) {
    return next(error);
  }
}

async function printFarmerMessage(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/farmer/messages');
    }

    const message = await ContactMessage.findOne({ _id: req.params.id, farmer: req.session.user.id }).lean();

    if (!message) {
      req.session.error = 'Message not found.';
      return res.redirect('/dashboard/farmer/messages');
    }

    return res.render('contacts/message-print', {
      title: `Print message: ${message.subject}`,
      message,
      printMode: true
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  showContactFarmerForm,
  sendContactFarmerMessage,
  farmerMessages,
  showFarmerMessage,
  printFarmerMessage
};
