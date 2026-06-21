const mongoose = require('mongoose');
const {
  ALLOWED_PRODUCT_IMAGE_MIME_TYPES,
  MAX_PROFILE_IMAGE_SIZE_BYTES,
  MAX_USER_DOCUMENT_SIZE_BYTES,
  ALLOWED_USER_DOCUMENT_MIME_TYPES
} = require('../config/productLimits');

const ACCOUNT_STATUSES = ['active', 'pending_approval', 'suspended'];
const DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'];

const profileField = {
  type: String,
  trim: true,
  maxlength: 120,
  default: ''
};

const longerProfileField = {
  type: String,
  trim: true,
  maxlength: 600,
  default: ''
};


const documentSchema = {
  filename: {
    type: String,
    trim: true,
    maxlength: 180,
    default: ''
    },
    storageKey: {
        type: String,
        trim: true,
        maxlength: 700,
        default: ''
    },
  storagePath: {
    type: String,
    trim: true,
    maxlength: 700,
    default: ''
  },
  mimetype: {
    type: String,
    enum: [...ALLOWED_USER_DOCUMENT_MIME_TYPES, ''],
    default: ''
  },
  size: {
    type: Number,
    min: 0,
    max: MAX_USER_DOCUMENT_SIZE_BYTES,
    default: 0
  },
  originalName: {
    type: String,
    trim: true,
    maxlength: 180,
    default: ''
  },
  uploadedAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: DOCUMENT_STATUSES,
    default: 'pending',
    index: true
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  rejectionReason: {
    type: String,
    trim: true,
    maxlength: 400,
    default: ''
  }
};

const imageSchema = {
  filename: {
    type: String,
    trim: true,
    maxlength: 180,
    default: ''
  },
  path: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  mimetype: {
    type: String,
    enum: [...ALLOWED_PRODUCT_IMAGE_MIME_TYPES, ''],
    default: ''
  },
  size: {
    type: Number,
    min: 0,
    max: MAX_PROFILE_IMAGE_SIZE_BYTES,
    default: 0
  },
  originalName: {
    type: String,
    trim: true,
    maxlength: 180,
    default: ''
  }
};

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address.']
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: ['farmer', 'buyer', 'admin'],
      required: true
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 7,
      match: [/^$|^\d{7}$/, 'Phone number must be exactly 7 digits.'],
      default: ''
    },
    accountStatus: {
      type: String,
      enum: ACCOUNT_STATUSES,
      default() {
        return this.role === 'admin' ? 'active' : 'pending_approval';
      },
      index: true
    },
    approvedAt: {
      type: Date,
      default: null
    },
    suspendedAt: {
      type: Date,
      default: null
    },
    statusNote: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ''
    },
    profileImage: imageSchema,
    verificationDocuments: {
      tinDocument: documentSchema,
      businessRegistrationCertificate: documentSchema
    },
    documentReviewStatus: {
      type: String,
      enum: DOCUMENT_STATUSES,
      default: 'pending',
      index: true
    },
    documentReviewNote: {
      type: String,
      trim: true,
      maxlength: 400,
      default: ''
    },
    loginSecurity: {
      failedLoginAttempts: {
        type: Number,
        min: 0,
        default: 0
      },
      lockedUntil: {
        type: Date,
        default: null,
        index: true
      },
      lastFailedLoginAt: {
        type: Date,
        default: null
      },
      lastLoginAt: {
        type: Date,
        default: null
      },
      lastLoginIp: {
        type: String,
        trim: true,
        maxlength: 80,
        default: ''
      }
    },
        passwordReset: {
            tokenHash: {
                type: String,
                trim: true,
                default: '',
                select: false,
                index: true
            },
            expiresAt: {
                type: Date,
                default: null,
                select: false,
                index: true
            },
            requestedAt: {
                type: Date,
                default: null
            }
        },
        passwordResetThrottle: {
            windowStartedAt: {
                type: Date,
                default: null
            },
            requestCount: {
                type: Number,
                min: 0,
                default: 0
            }
        },
        authSessionVersion: {
            type: Number,
            min: 0,
            default: 0
        },
    farmerProfile: {
      farmName: profileField,
      ownerName: profileField,
      phone: profileField,
      farmLocation: profileField,
      farmAddress: {
        type: String,
        trim: true,
        maxlength: 250,
        default: ''
      },
      farmDescription: longerProfileField,
      pickupOptions: {
        type: String,
        trim: true,
        maxlength: 300,
        default: ''
      },
      deliveryOptions: {
        type: String,
        trim: true,
        maxlength: 300,
        default: ''
      },
      bankName: {
        type: String,
        trim: true,
        maxlength: 120,
        default: ''
      },
      bankAccountNumber: {
        type: String,
        trim: true,
        maxlength: 80,
        default: ''
      },
      mpaisaNumber: {
        type: String,
        trim: true,
        maxlength: 40,
        default: ''
      },
      mycashNumber: {
        type: String,
        trim: true,
        maxlength: 40,
        default: ''
      },
      mainProducts: {
        type: String,
        trim: true,
        maxlength: 200,
        default: ''
      }
    },
    buyerProfile: {
      organization: profileField,
      contactName: profileField,
      phone: profileField,
      buyingLocation: profileField,
      deliveryAddress: {
        type: String,
        trim: true,
        maxlength: 250,
        default: ''
      },
      preferredContactMethod: {
        type: String,
        enum: ['email', 'phone', 'either', ''],
        default: 'email'
      },
      interestedProducts: {
        type: String,
        trim: true,
        maxlength: 200,
        default: ''
      },
      buyingNotes: longerProfileField
    }
  },
  {
    timestamps: true
  }
);


userSchema.index(
    { phone: 1 },
    {
        name: 'phone_unique_non_empty',
        unique: true,
        partialFilterExpression: {
            $and: [
                { phone: { $type: 'string' } },
                { phone: { $gt: '' } }
            ]
        }
    }
);
userSchema.index({ 'farmerProfile.farmAddress': 1 });
userSchema.index({ 'buyerProfile.deliveryAddress': 1 });
userSchema.index({ role: 1, accountStatus: 1, createdAt: -1 });
userSchema.index({ documentReviewStatus: 1, createdAt: -1 });


const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ACCOUNT_STATUSES = ACCOUNT_STATUSES;
module.exports.DOCUMENT_STATUSES = DOCUMENT_STATUSES;
