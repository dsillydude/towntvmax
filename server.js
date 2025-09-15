// server.js - Townmax backend (Express + Mongoose + Admin Auth)

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
let allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : null;
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS not allowed'), false);
    }
    return callback(null, true);
  }
}));

app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// MongoDB connect
const rawUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'townmax';
const MONGODB_URI = rawUri.includes('/') ? rawUri.replace(/\/(\?|$)/, `/${dbName}$1`) : `${rawUri}/${dbName}`;

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI)
  .then(() => console.log(`MongoDB connected: ${MONGODB_URI}`))
  .catch(err => console.error('MongoDB error:', err.message));

const Schema = mongoose.Schema;

// Schemas
const AdminSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const SubCategorySchema = new Schema({
  parentCategory: { type: String, enum: ['sports', 'movies', 'series', 'trending'], required: true },
  name: { type: String, required: true },
  key: { type: String, required: true },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
});

const BannerSchema = new Schema({
  title: String,
  subtitle: String,
  imageUrl: String,
  actionType: { type: String, enum: ['content', 'channel', 'external'], default: 'external' },
  actionValue: String,
  isVertical: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  position: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const ChannelSchema = new Schema({
  channelId: { type: String, required: true, unique: true },
  name: String,
  description: String,
  category: { type: String, enum: ['sports', 'movies', 'series', 'trending'], required: true },
  subCategory: { type: String, default: 'all' },
  playbackUrl: String,
  drmEnabled: { type: Boolean, default: false },
  drmProvider: { type: String },
  drmLicenseUrl: { type: String },
  drmHeaders: { type: Schema.Types.Mixed },
  cookieValue: { type: String },
  referrer: { type: String },
  origin: { type: String },
  customUserAgent: { type: String },
  thumbnailUrl: String,
  isPremium: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const ContentSchema = new Schema({
  contentId: { type: String, required: true, unique: true },
  title: String,
  description: String,
  type: { type: String, enum: ['movie', 'episode', 'clip', 'other'], default: 'movie' },
  category: { type: String, enum: ['sports', 'movies', 'series', 'trending'], required: true },
  subCategory: { type: String, default: 'all' },
  streamUrl: String,
  drmEnabled: { type: Boolean, default: false },
  drmProvider: { type: String },
  drmLicenseUrl: { type: String },
  drmHeaders: { type: Schema.Types.Mixed },
  cookieValue: { type: String },
  referrer: { type: String },
  origin: { type: String },
  customUserAgent: { type: String },
  posterUrl: String,
  isPremium: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Models
const Admin = mongoose.model('Admin', AdminSchema);
const SubCategory = mongoose.model('SubCategory', SubCategorySchema);
const Banner = mongoose.model('Banner', BannerSchema);
const Channel = mongoose.model('Channel', ChannelSchema);
const Content = mongoose.model('Content', ContentSchema);

// Normalizers
function normalizeBanner(doc) {
  if (!doc) return null;
  return {
    id: doc._id, title: doc.title, subtitle: doc.subtitle, imageUrl: doc.imageUrl,
    actionType: doc.actionType, actionValue: doc.actionValue,
    isVertical: !!doc.isVertical, isActive: !!doc.isActive, position: doc.position || 0
  };
}

function normalizeChannel(doc) {
  if (!doc) return null;
  return {
    channelId: doc.channelId, name: doc.name, description: doc.description,
    category: doc.category, subCategory: doc.subCategory, playbackUrl: doc.playbackUrl,
    drmEnabled: !!doc.drmEnabled, drmProvider: doc.drmProvider, drmLicenseUrl: doc.drmLicenseUrl,
    drmHeaders: doc.drmHeaders || {}, cookieValue: doc.cookieValue || null,
    referrer: doc.referrer || null, origin: doc.origin || null, customUserAgent: doc.customUserAgent || null,
    thumbnailUrl: doc.thumbnailUrl || null, isPremium: !!doc.isPremium, isActive: !!doc.isActive
  };
}

function normalizeContent(doc) {
  if (!doc) return null;
  return {
    contentId: doc.contentId, title: doc.title, description: doc.description,
    type: doc.type, category: doc.category, subCategory: doc.subCategory,
    streamUrl: doc.streamUrl, drmEnabled: !!doc.drmEnabled, drmProvider: doc.drmProvider,
    drmLicenseUrl: doc.drmLicenseUrl, drmHeaders: doc.drmHeaders || {},
    cookieValue: doc.cookieValue || null, referrer: doc.referrer || null,
    origin: doc.origin || null, customUserAgent: doc.customUserAgent || null,
    posterUrl: doc.posterUrl || null, isPremium: !!doc.isPremium, isActive: !!doc.isActive
  };
}

// Middleware: verify admin token
function verifyAdmin(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, process.env.JWT_SECRET || 'secretkey', (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.adminId = decoded.id;
    next();
  });
}

// Routes

// Health
app.get('/', (req, res) => res.json({ ok: true, now: new Date() }));

// Public routes
app.get('/api/banners', async (req, res) => {
  try {
    const banners = await Banner.find({ isActive: true }).sort({ position: 1, createdAt: -1 }).limit(50);
    res.json({ banners: banners.map(normalizeBanner) });
  } catch (err) { res.status(500).json({ error: 'Failed to load banners' }); }
});

app.get('/api/subcategories', async (req, res) => {
  try {
    const parent = (req.query.parent || '').toLowerCase();
    if (!parent) return res.status(400).json({ error: 'parent query required' });
    const subs = await SubCategory.find({ parentCategory: parent, isActive: true }).sort({ order: 1 });
    res.json({ subcategories: subs.map(s => ({ name: s.name, key: s.key, order: s.order })) });
  } catch (err) { res.status(500).json({ error: 'Failed to load subcategories' }); }
});

app.get('/api/channels', async (req, res) => {
  try {
    const q = {};
    if (req.query.category) q.category = req.query.category.toLowerCase();
    if (req.query.subCategory) q.subCategory = req.query.subCategory;
    if (req.query.isPremium !== undefined) q.isPremium = req.query.isPremium === 'true';
    q.isActive = true;
    const list = await Channel.find(q).limit(200).sort({ createdAt: -1 });
    res.json({ channels: list.map(normalizeChannel) });
  } catch (err) { res.status(500).json({ error: 'Failed to load channels' }); }
});

app.get('/api/content', async (req, res) => {
  try {
    const q = {};
    if (req.query.category) q.category = req.query.category.toLowerCase();
    if (req.query.subCategory) q.subCategory = req.query.subCategory;
    if (req.query.isPremium !== undefined) q.isPremium = req.query.isPremium === 'true';
    q.isActive = true;
    const list = await Content.find(q).limit(200).sort({ createdAt: -1 });
    res.json({ content: list.map(normalizeContent) });
  } catch (err) { res.status(500).json({ error: 'Failed to load content' }); }
});

app.get('/api/trending', async (req, res) => {
  try {
    const sampleSize = parseInt(req.query.size || '8', 10);
    const channels = await Channel.aggregate([{ $match: { category: 'trending', isActive: true } }, { $sample: { size: sampleSize } }]);
    const contents = await Content.aggregate([{ $match: { category: 'trending', isActive: true } }, { $sample: { size: sampleSize } }]);
    res.json({ channels: channels.map(normalizeChannel), content: contents.map(normalizeContent) });
  } catch (err) { res.status(500).json({ error: 'Failed to load trending' }); }
});

// Admin routes
app.post('/api/admin/seed', async (req, res) => {
  try {
    const existing = await Admin.findOne({ username: 'admin' });
    if (existing) return res.json({ message: 'Admin already exists' });
    const hashed = await bcrypt.hash('ourfam2019', 10);
    await new Admin({ username: 'admin', password: hashed }).save();
    res.json({ message: 'Admin created', username: 'admin', password: 'ourfam2019' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '7d' });
    
    // CHANGE: Send back the token AND the admin's details (without the password)
    res.json({ 
  token, 
  admin: {
    id: admin._id,
    username: admin.username,
    email: admin.email || "",
    role: "admin",
    isActive: true,
    createdAt: admin.createdAt || new Date(),
    lastLogin: new Date()
  }
});

  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Protected CRUD
app.get('/api/admin/banners', verifyAdmin, async (req, res) => res.json({ banners: (await Banner.find()).map(normalizeBanner) }));
app.post('/api/admin/banners', verifyAdmin, async (req, res) => res.json(await new Banner(req.body).save()));
app.put('/api/admin/banners/:id', verifyAdmin, async (req, res) => res.json(await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true })));
app.delete('/api/admin/banners/:id', verifyAdmin, async (req, res) => res.json(await Banner.findByIdAndDelete(req.params.id)));

app.get('/api/admin/channels', verifyAdmin, async (req, res) => res.json({ channels: (await Channel.find()).map(normalizeChannel) }));
app.post('/api/admin/channels', verifyAdmin, async (req, res) => res.json(await new Channel(req.body).save()));
app.put('/api/admin/channels/:id', verifyAdmin, async (req, res) => res.json(await Channel.findByIdAndUpdate(req.params.id, req.body, { new: true })));
app.delete('/api/admin/channels/:id', verifyAdmin, async (req, res) => res.json(await Channel.findByIdAndDelete(req.params.id)));

app.get('/api/admin/content', verifyAdmin, async (req, res) => res.json({ content: (await Content.find()).map(normalizeContent) }));
app.post('/api/admin/content', verifyAdmin, async (req, res) => res.json(await new Content(req.body).save()));
app.put('/api/admin/content/:id', verifyAdmin, async (req, res) => res.json(await Content.findByIdAndUpdate(req.params.id, req.body, { new: true })));
app.delete('/api/admin/content/:id', verifyAdmin, async (req, res) => res.json(await Content.findByIdAndDelete(req.params.id)));

app.get('/api/admin/subcategories', verifyAdmin, async (req, res) => res.json(await SubCategory.find()));
app.post('/api/admin/subcategories', verifyAdmin, async (req, res) => res.json(await new SubCategory(req.body).save()));
app.put('/api/admin/subcategories/:id', verifyAdmin, async (req, res) => res.json(await SubCategory.findByIdAndUpdate(req.params.id, req.body, { new: true })));
app.delete('/api/admin/subcategories/:id', verifyAdmin, async (req, res) => res.json(await SubCategory.findByIdAndDelete(req.params.id)));

app.get('/api/admin/me', verifyAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.adminId).select('-password');
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json({ admin });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin profile' });
  }
});



// Start server
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
