const User = require('../models/User');

function redirectToLogin(req, res) {
  return res.redirect('/login');
}

function destroySuspendedSession(req, res) {
  return req.session.destroy(() => {
    res.clearCookie('agrolink.sid');
    return res.redirect('/login');
  });
}

async function refreshSessionUser(req) {
    if (req.sessionUserValidationComplete) {
        return req.validatedSessionUser || null;
    }

    req.sessionUserValidationComplete = true;
    req.validatedSessionUser = null;

    if (!req.session.user?.id) {
        return null;
    }

    const user = await User.findById(req.session.user.id)
        .select(
            'name email role accountStatus farmerProfile buyerProfile profileImage authSessionVersion'
        )
        .lean();

    if (!user) {
        req.session.user = null;
        req.session.adminReauthenticatedAt = null;

        return null;
    }

    const browserSessionVersion = Number(
        req.session.user.authSessionVersion || 0
    );

    const activeSessionVersion = Number(
        user.authSessionVersion || 0
    );

    if (
        browserSessionVersion !==
        activeSessionVersion
    ) {
        req.session.user = null;
        req.session.adminReauthenticatedAt = null;

        req.session.error =
            'Your session ended because your password was changed. Please log in again.';

        return null;
    }

    req.session.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        accountStatus:
            user.accountStatus || 'active',
        authSessionVersion:
            activeSessionVersion
    };

    req.validatedSessionUser = user;

    return user;
}
async function validateSessionUser(
    req,
    res,
    next
) {
    try {
        if (!req.session.user?.id) {
            return next();
        }

        const user =
            await refreshSessionUser(req);

        if (!user) {
            return redirectToLogin(req, res);
        }

        if (
            user.accountStatus ===
            'suspended'
        ) {
            return destroySuspendedSession(
                req,
                res
            );
        }

        return next();
    } catch (error) {
        return next(error);
    }
}

async function requireAuth(req, res, next) {
  try {
    if (!req.session.user) {
      return redirectToLogin(req, res);
    }

    const user = await refreshSessionUser(req);

    if (!user) {
      return redirectToLogin(req, res);
    }

    if (user.accountStatus === 'suspended') {
      return destroySuspendedSession(req, res);
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

async function redirectIfAuthenticated(req, res, next) {
    try {
        if (!req.session.user) {
            return next();
        }

        const user = await refreshSessionUser(req);

        if (!user) {
            return next();
        }

        if (user.accountStatus === 'suspended') {
            return destroySuspendedSession(req, res);
        }

        return res.redirect('/dashboard');
    } catch (error) {
        return next(error);
    }
}

function requireRole(role) {
  return async (req, res, next) => {
    try {
      if (!req.session.user) {
        return redirectToLogin(req, res);
      }

      const user = await refreshSessionUser(req);

      if (!user) {
        return redirectToLogin(req, res);
      }

      if (user.accountStatus === 'suspended') {
        return destroySuspendedSession(req, res);
      }

      if (req.session.user.role !== role) {
        return res.status(403).render('errors/403', {
          title: 'Access denied'
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}


function requireApprovedBuyer(req, res, next) {
  if (!req.session.user) {
    return redirectToLogin(req, res);
  }

  if (req.session.user.role !== 'buyer') {
    return res.status(403).render('errors/403', {
      title: 'Access denied'
    });
  }

  if (req.session.user.accountStatus !== 'active') {
    req.session.error = 'Your buyer account is waiting for admin approval before you can place orders or contact farmers.';
    return res.redirect('/dashboard/buyer');
  }

  return next();
}

function requireApprovedFarmer(req, res, next) {
  if (!req.session.user) {
    return redirectToLogin(req, res);
  }

  if (req.session.user.role !== 'farmer') {
    return res.status(403).render('errors/403', {
      title: 'Access denied'
    });
  }

  if (req.session.user.accountStatus !== 'active') {
    req.session.error = 'Your farmer account is waiting for admin approval before you can manage products or orders.';
    return res.redirect('/dashboard/farmer');
  }

  return next();
}

module.exports = {
    requireAuth,
    redirectIfAuthenticated,
    requireRole,
    requireApprovedFarmer,
    requireApprovedBuyer,
    refreshSessionUser,
    validateSessionUser
};
