const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config/env');
const {
    logger
} = require('./services/loggerService');
const {
    attachCsrfTokenForAuthenticatedUser
} = require('./middleware/csrf');
const { attachLocals } = require('./middleware/locals');
const errorHandler = require('./middleware/errorHandler');
const pageRoutes = require('./routes/pageRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const messageRoutes = require('./routes/messageRoutes');
const contactRoutes = require('./routes/contactRoutes');
const profileRoutes = require('./routes/profileRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reportRoutes = require('./routes/reportRoutes');
const { attachNotificationLocals } = require('./middleware/notificationLocals');
const {
    validateSessionUser
} = require('./middleware/auth');
const { attachRequestId } = require('./middleware/requestId');
const {
    sameOriginUnsafeRequestGuard
} = require('./middleware/sameOrigin');
const {
    attachStructuredRequestLogger
} = require('./middleware/requestLogger');
const publicDir = path.join(__dirname, '..', 'public');
const assetManifestPath = path.join(publicDir, 'asset-manifest.json');

function loadAssetManifest() {
  try {
    return JSON.parse(fs.readFileSync(assetManifestPath, 'utf8'));
  } catch (error) {
    if (config.isProduction) {
      throw new Error('Missing or invalid public/asset-manifest.json. Run npm run build before starting the production server.');
    }

    return {};
  }
}

const assetManifest = loadAssetManifest();

function assetPath(sourcePath) {
  const normalizedPath = sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;
  return assetManifest[normalizedPath] || normalizedPath;
}

function setStaticCacheHeaders(res, filePath) {
  const relativePath = path.relative(publicDir, filePath).split(path.sep).join('/');
  const hashedAssetPattern = /^dist\/assets\/.+\.[a-f0-9]{12}\.[^/]+$/i;

  if (hashedAssetPattern.test(relativePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  if (relativePath.startsWith('uploads/')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return;
  }

  if (
    relativePath === 'service-worker.js' ||
    relativePath === 'manifest.webmanifest' ||
    relativePath === 'asset-manifest.json' ||
    relativePath === 'offline.html'
  ) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }

  res.setHeader('Cache-Control', 'no-cache');
}

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (req, res) => {
    return res.status(200).json({
        status: 'ok'
    });
});
async function pingDatabase(timeoutMs = 3000) {
    let timeoutId;

    try {
        await Promise.race([
            mongoose.connection.db.admin().command({ ping: 1 }),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(
                        new Error(
                            'MongoDB readiness check timed out.'
                        )
                    );
                }, timeoutMs);

                timeoutId.unref?.();
            })
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

app.get('/readyz', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (
        mongoose.connection.readyState !== 1 ||
        !mongoose.connection.db
    ) {
        return res.status(503).json({
            status: 'not_ready'
        });
    }

    try {
        await pingDatabase();

        return res.status(200).json({
            status: 'ready'
        });
    } catch (error) {
        logger.error(
            'Readiness check failed.',
            {
                event: 'health.readiness.failed',
                error
            }
        );

        return res.status(503).json({
            status: 'not_ready'
        });
    }
});

app.locals.assetPath = assetPath;

app.set(
    'trust proxy',
    config.trustProxyHops
);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", 'data:'],
        "media-src": ["'self'"],
        "font-src": ["'self'"],
        "worker-src": ["'self'"],
        "manifest-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
        // Keep HTTP assets working during LAN/mobile development.
        // In production HTTPS, Helmet will include upgrade-insecure-requests.
        "upgrade-insecure-requests": config.isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(attachRequestId);
app.use(compression());
app.use(express.static(publicDir, {
  setHeaders: setStaticCacheHeaders
}));

if (config.isProduction) {
    app.use(attachStructuredRequestLogger);
} else {
    app.use(morgan('dev'));
}

// Reject cross-site unsafe requests before parsing request bodies or multipart uploads.
app.use(sameOriginUnsafeRequestGuard);

app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser(config.cookieSecret));

app.use(
  session({
    name: 'agrolink.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      mongoUrl: config.mongoUri,
      collectionName: 'sessions',
      ttl: 60 * 60 * 24
    }),
    unset: 'destroy',
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: config.isProduction ? 'strict' : 'lax',
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.use(validateSessionUser);
app.use(attachLocals);
app.use(attachCsrfTokenForAuthenticatedUser);
app.use(attachNotificationLocals);

app.use('/dashboard', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  return next();
});

app.use('/', pageRoutes);
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/dashboard', productRoutes);
app.use('/dashboard', orderRoutes);
app.use('/dashboard', notificationRoutes);
app.use('/dashboard', messageRoutes);
app.use('/dashboard', contactRoutes);
app.use('/dashboard', profileRoutes);
app.use('/dashboard', adminRoutes);
app.use('/dashboard', reportRoutes);

function dashboardRedirectPath(req) {
  if (req.session.user?.role === 'buyer') return '/dashboard/buyer';
  if (req.session.user?.role === 'farmer') return '/dashboard/farmer';
  if (req.session.user?.role === 'admin') return '/dashboard/admin';
  return '/';
}

app.use((req, res) => {
  if (req.session.user) {
    req.session.error = 'Page not found. You were redirected to your dashboard.';
    return res.redirect(dashboardRedirectPath(req));
  }

  return res.status(404).render('errors/404', {
    title: 'Page not found'
  });
});

app.use(errorHandler);

module.exports = app;
