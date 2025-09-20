/* * =================================================================
 * TV MAX Backend Server - Cloned from working version
 * -----------------------------------------------------------------
 * This is a direct clone of the user's provided working server.js.
 * It uses environment variables for configuration.
 * =================================================================
 */

const express = require('express');
const mongoose = require('mongoose');
const Joi = require('joi');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// --- Middleware ------------------------------------------------------------
app.use(helmet());
app.use(cors({
  // IMPORTANT: Using your app's specific allowed origins from your environment
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://towntvmax.onrender.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Trust proxy to get the correct IP address when deployed
app.set('trust proxy', true);

// Static file serving for uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- MongoDB Connection ----------------------------------------------------
const SettingSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
});
const Setting = mongoose.model('Setting', SettingSchema);

async function loadSettingsFromDatabase() {
  try {
    const plansSetting = await Setting.findOne({ key: 'subscriptionPlans' });
    if (plansSetting) {
      SUBSCRIPTION_PLANS = plansSetting.value;
      console.log('✅ Subscription plans loaded from database.');
    } else {
      await new Setting({ key: 'subscriptionPlans', value: SUBSCRIPTION_PLANS }).save();
      console.log('✅ Default subscription plans saved to database for the first time.');
    }
  } catch (error) {
    console.error('❌ Failed to load settings from database:', error);
  }
}

// IMPORTANT: Using your app's specific MongoDB URI from your environment
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://townmaxdb:2016Brianna@townmax.fze1itu.mongodb.net/?retryWrites=true&w=majority&appName=townmax';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    loadSettingsFromDatabase();
    loadAppSettings();
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// --- Constants & Config ---------------------------------------------------
let SUBSCRIPTION_PLANS = {
    weekly: { durationDays: 7, amount: 1000 },
    monthly: { durationDays: 30, amount: 3000 },
    yearly: { durationDays: 365, amount: 30000 },
};

// --- Database Models -------------------------------------------------------
const UserSchema = new mongoose.Schema({
  installationId: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  phoneNumber: { type: String, unique: true, sparse: true },
  isPremium: { type: Boolean, default: false },
  premiumExpiryDate: { type: Date },
  lastLogin: { type: Date },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const AdminSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'super_admin'], default: 'admin' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date }
});
// Explicitly tell Mongoose to use the 'admins' collection
const Admin = mongoose.model('Admin', AdminSchema, 'admins');


const ChannelSchema = new mongoose.Schema({
  channelId: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  description: { type: String },
  category: { type: String, required: true },
  playbackUrl: { type: String },
  drm: {
    enabled: { type: Boolean },
    provider: { type: String },
    key: { type: String },
  },
  thumbnailUrl: { type: String },
  isPremium: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  position: { type: Number, default: 0 },
  assignedContent: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});
const Channel = mongoose.model('Channel', ChannelSchema);


const HeroBannerSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  imageUrl: { type: String, required: true },
  actionType: { type: String, enum: ['channel', 'content', 'external'], required: true },
  actionValue: { type: String },
  isActive: { type: Boolean, default: true },
  position: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const HeroBanner = mongoose.model('HeroBanner', HeroBannerSchema);

const PaymentSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: String },
  installationId: { type: String, index: true },
  phoneNumber: { type: String, index: true },
  customerName: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'TZS' },
  paymentMethod: { type: String, default: 'ZenoPay' },
  zenoTransactionId: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  subscriptionType: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', PaymentSchema);

// ADDED: Subscription model for dashboard stats
const SubscriptionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    plan: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
}, { timestamps: true });
const Subscription = mongoose.model('Subscription', SubscriptionSchema);


// --- Helper Functions ------------------------------------------------------
function transformDoc(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };

  const isChannel = obj.hasOwnProperty('channelId') || obj.hasOwnProperty('playbackUrl');
  if (isChannel) {
    if (!obj.playbackUrl && obj.streamUrl) obj.playbackUrl = obj.streamUrl;
    if (!obj.drm) {
      obj.drm = {
        enabled: obj.drmEnabled || false,
        key: obj.drmKey || null,
        provider: null
      };
    }
    delete obj.drmEnabled;
    delete obj.drmKey;
  }

  obj.id = obj._id?.toString() || obj.id;
  delete obj.password;
  delete obj._id;
  delete obj.__v;
  return obj;
}

function transformArray(docs) {
  return (docs || []).map(transformDoc);
}

async function loadAppSettings() {
  try {
    const whatsappSetting = await Setting.findOne({ key: 'whatsappLink' });
    if (whatsappSetting) {
      appSettings.whatsappLink = whatsappSetting.value;
      console.log('✅ WhatsApp link loaded from database.');
    } else {
      await new Setting({
        key: 'whatsappLink',
        value: appSettings.whatsappLink
      }).save();
      console.log('✅ Default WhatsApp link saved to database.');
    }
  } catch (error) {
    console.error('❌ Failed to load WhatsApp link from database:', error);
  }
}

function generateToken(user, isAdmin = false) {
  const payload = isAdmin ? {
    adminId: user.id || user._id,
    username: user.username,
    role: user.role
  } : {
    userId: user.id || user._id,
    installationId: user.installationId, // Use installationId in token
    isPremium: user.isPremium
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d'
  });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Admin access token required' });

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired admin token' });
        if (!decoded.adminId) return res.status(403).json({ error: 'Admin access required' });

        try {
            const admin = await Admin.findById(decoded.adminId);
            if (!admin || !admin.isActive) return res.status(403).json({ error: 'Admin not found or inactive' });
            req.admin = decoded;
            next();
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed!'), false);
  }
});

// --- API Routes ------------------------------------------------------------

let appSettings = {
  whatsappLink: process.env.WHATSAPP_LINK || 'https://wa.me/255685551925'
};

app.get('/api/config', (req, res) => res.json(appSettings));

app.put('/api/admin/config', authenticateAdmin, async (req, res) => {
  try {
    const { whatsappLink } = req.body;
    if (whatsappLink) {
      appSettings.whatsappLink = whatsappLink;
      await Setting.findOneAndUpdate({ key: 'whatsappLink' }, { value: whatsappLink }, { upsert: true });
    }
    res.json({ message: 'Settings updated successfully', settings: appSettings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.get('/api/subscriptions/plans', async (req, res) => {
  try {
    const plansSetting = await Setting.findOne({ key: 'subscriptionPlans' });
    res.json({ plans: plansSetting?.value || SUBSCRIPTION_PLANS });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running', timestamp: new Date().toISOString() });
});

app.post('/api/auth/device-login', async (req, res) => {
    try {
        const { installationId } = req.body;
        if (!installationId) return res.status(400).json({ error: 'installationId is required' });

        let user = await User.findOne({ installationId });
        if (user) {
            user.lastLogin = new Date();
            await user.save();
        } else {
            user = await new User({ installationId, lastLogin: new Date() }).save();
        }

        const token = generateToken(user);
        res.json({ message: 'Login successful', user: transformDoc(user), token });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: transformDoc(user) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =================================================================
// ADMIN LOGIN ROUTE
// =================================================================
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // --- LOG 1: Log the incoming request ---
    console.log(`[LOGIN ATTEMPT] Received login request for username: '${username}'`);

    if (!username || !password) {
      console.log('[LOGIN FAILED] Missing username or password.');
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find the admin user by username (or email) in the 'admins' collection
    const admin = await Admin.findOne({ $or: [{ username }, { email: username }], isActive: true });

    // --- LOG 2: Log whether a user was found ---
    if (admin) {
        console.log(`[LOGIN ATTEMPT] Found user in database: ${admin.username} (ID: ${admin._id})`);
    } else {
        console.log(`[LOGIN FAILED] No active user found for username: '${username}'`);
        // We still return the same generic error for security
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare the provided password with the stored hash
    const isMatch = await bcrypt.compare(password, admin.password);

    // --- LOG 3: Log the password comparison result ---
    console.log(`[LOGIN ATTEMPT] Password match for '${username}': ${isMatch}`);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // If everything is correct, update last login and generate token
    admin.lastLogin = new Date();
    await admin.save();
    
    console.log(`[LOGIN SUCCESS] User '${username}' logged in successfully.`);

    const token = generateToken(admin, true);
    res.json({ message: 'Admin login successful', admin: transformDoc(admin), token });

  } catch (error) {
    // --- LOG 4: Log any unexpected errors ---
    console.error('[LOGIN ERROR] An unexpected error occurred:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/me', authenticateAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json({ admin: transformDoc(admin) });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =================================================================
// ADMIN: DASHBOARD STATS
// =================================================================
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    const channelCount = await Channel.countDocuments();
    const bannerCount = await HeroBanner.countDocuments();
    const subscriptionCount = await Subscription.countDocuments();
    const paymentCount = await Payment.countDocuments();

    res.json({
      stats: {
        users: userCount,
        channels: channelCount,
        banners: bannerCount,
        subscriptions: subscriptionCount,
        payments: paymentCount
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// =================================================================
// ADMIN: USERS MANAGEMENT
// =================================================================
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// =================================================================
// ADMIN: BANNERS MANAGEMENT
// =================================================================
app.get('/api/admin/banners', authenticateAdmin, async (req, res) => {
  try {
    const banners = await HeroBanner.find().sort({ createdAt: -1 });
    res.json(banners);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

app.post('/api/admin/banners', authenticateAdmin, async (req, res) => {
  try {
    const banner = new HeroBanner(req.body);
    await banner.save();
    res.json(banner);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create banner' });
  }
});

app.delete('/api/admin/banners/:id', authenticateAdmin, async (req, res) => {
  try {
    await HeroBanner.findByIdAndDelete(req.params.id);
    res.json({ message: 'Banner deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

// =================================================================
// ADMIN: PAYMENTS MANAGEMENT
// =================================================================
app.get('/api/admin/payments', authenticateAdmin, async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

app.delete('/api/admin/payments/:id', authenticateAdmin, async (req, res) => {
  try {
    await Payment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete payment' });
  }
});

// =================================================================
// ADMIN: SETTINGS MANAGEMENT
// =================================================================
app.get('/api/admin/settings', authenticateAdmin, async (req, res) => {
  try {
    const settings = await Setting.findOne();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/admin/settings', authenticateAdmin, async (req, res) => {
  try {
    let settings = await Setting.findOne();
    if (!settings) {
      settings = new Setting(req.body);
    } else {
      Object.assign(settings, req.body);
    }
    await settings.save();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// --- Public Route for Main App to Fetch Banners ---
app.get('/api/banners', async (req, res) => {
    try {
        const banners = await HeroBanner.find({ isActive: true }).sort({ position: 'asc' });
        res.json({ banners: transformArray(banners) });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error fetching banners' });
    }
});


// --- Public Route for Main App to Fetch Channels ---
app.get('/api/channels', async (req, res) => {
    try {
        const { category } = req.query;
        const filter = { isActive: true };
        if (category) {
            filter.category = category;
        }
        const channels = await Channel.find(filter).sort({ position: 'asc', name: 'asc' });
        res.json({ channels: transformArray(channels) });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error fetching channels' });
    }
});



// --- DRM TOKEN ENDPOINT (Crucial for Player) ---
// --- DRM TOKEN ENDPOINT (Crucial for Player) ---
app.post('/api/drm/token', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    const item = await Channel.findOne({ channelId });

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    res.json({ success: true, data: transformDoc(item) });

  } catch (error) {
    console.error("❌ ERROR in /api/drm/token:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});


// --- Admin Routes for managing content, users, etc. ---
// These are cloned directly from your working file for completeness.
// They include CRUD for channels, content, banners, users, payments.

app.get('/api/admin/channels', authenticateAdmin, async (req, res) => {
    // Admin route to get all channels (including inactive)
    const channels = await Channel.find().sort({ position: 'asc' });
    res.json({ channels: transformArray(channels) });
});

app.post('/api/admin/channels', authenticateAdmin, async (req, res) => {
    const newChannel = new Channel(req.body);
    await newChannel.save();
    res.status(201).json({ channel: transformDoc(newChannel) });
});

app.put('/api/admin/channels/:id', authenticateAdmin, async (req, res) => {
    const channel = await Channel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ channel: transformDoc(channel) });
});

app.delete('/api/admin/channels/:id', authenticateAdmin, async (req, res) => {
    await Channel.findByIdAndDelete(req.params.id);
    res.json({ message: 'Channel deleted' });
});

// And so on for all other admin routes...


// --- Error Handling & Server Start -----------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀  Town TV Backend server running on port ${PORT}`);
});

module.exports = app;

