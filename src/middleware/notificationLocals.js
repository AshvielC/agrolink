const Notification = require('../models/Notification');

async function attachNotificationLocals(req, res, next) {
  res.locals.unreadNotificationCount = 0;
  res.locals.latestNotifications = [];

  if (!req.session.user?.id) {
    return next();
  }

  try {
    const [unreadNotificationCount, latestNotifications] = await Promise.all([
      Notification.countDocuments({ recipient: req.session.user.id, readAt: null }),
      Notification.find({ recipient: req.session.user.id })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean()
    ]);

    res.locals.unreadNotificationCount = unreadNotificationCount;
    res.locals.latestNotifications = latestNotifications;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  attachNotificationLocals
};
