const mongoose = require('mongoose');
const Notification = require('../models/Notification');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}


async function notificationCount(req, res, next) {
  try {
    const unreadNotificationCount = await Notification.countDocuments({
      recipient: req.session.user.id,
      readAt: null
    });

    return res.json({ unreadNotificationCount });
  } catch (error) {
    return next(error);
  }
}

async function listNotifications(req, res, next) {
  try {
    const notifications = await Notification.find({ recipient: req.session.user.id })
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();

    return res.render('notifications/index', {
      title: 'Notifications',
      notifications
    });
  } catch (error) {
    return next(error);
  }
}

async function showNotification(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Notification not found.';
      return res.redirect('/dashboard/notifications');
    }

    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.session.user.id
    })
      .populate('actor', 'name email role farmerProfile buyerProfile')
      .lean();

    if (!notification) {
      req.session.error = 'Notification not found.';
      return res.redirect('/dashboard/notifications');
    }

    if (!notification.readAt) {
      await Notification.updateOne(
        { _id: notification._id, recipient: req.session.user.id },
        { readAt: new Date() }
      );
      notification.readAt = new Date();
      res.locals.unreadNotificationCount = Math.max((res.locals.unreadNotificationCount || 1) - 1, 0);
    }

    return res.render('notifications/show', {
      title: notification.title,
      notification
    });
  } catch (error) {
    return next(error);
  }
}

async function markNotificationRead(req, res, next) {
  try {
    if (!isValidObjectId(req.params.id)) {
      req.session.error = 'Notification not found.';
      return res.redirect('/dashboard/notifications');
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.session.user.id },
      { readAt: new Date() },
      { new: true }
    ).lean();

    if (!notification) {
      req.session.error = 'Notification not found.';
      return res.redirect('/dashboard/notifications');
    }

    return res.redirect(`/dashboard/notifications/${notification._id}`);
  } catch (error) {
    return next(error);
  }
}

async function markAllNotificationsRead(req, res, next) {
  try {
    await Notification.updateMany(
      { recipient: req.session.user.id, readAt: null },
      { readAt: new Date() }
    );

    req.session.success = 'Notifications marked as read.';
    return res.redirect('/dashboard/notifications');
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listNotifications,
  showNotification,
  markNotificationRead,
  markAllNotificationsRead,
  notificationCount
};
