// server.js - Townmax backend (Express + Mongoose)
// Provides APIs: /api/banners, /api/channels, /api/content, /api/subcategories, /api/trending
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration: allow origins from env or allow all for dev
let allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : null;
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));

app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
// serve uploads
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Connect to MongoDB
const rawUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'townmax';
const MONGODB_URI = rawUri.includes('/')
  ? rawUri.replace(/\/(\?|$)/, `/${dbName}$1`)
  : `${rawUri}/${dbName}`;

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI)
  .then(() => console.log(`MongoDB connected: ${MONGODB_URI}`))
  .catch(err => console.error('MongoDB connection error:', err.message));

// Schemas
const Schema = mongoose.Schema;

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
  drmProvider: { type: String }, // widevine, playready, clearkey
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
const SubCategory = mongoose.model('SubCategory', SubCategorySchema);
const Banner = mongoose.model('Banner', BannerSchema);
const Channel = mongoose.model('Channel', ChannelSchema);
const Content = mongoose.model('Content', ContentSchema);

// Utility: normalize doc to plain object with selected fields
function normalizeBanner(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    title: doc.title,
    subtitle: doc.subtitle,
    imageUrl: doc.imageUrl,
    actionType: doc.actionType,
    actionValue: doc.actionValue,
    isVertical: !!doc.isVertical,
    isActive: !!doc.isActive,
    position: doc.position || 0
  };
}

function normalizeChannel(doc) {
  if (!doc) return null;
  return {
    channelId: doc.channelId,
    name: doc.name,
    description: doc.description,
    category: doc.category,
    subCategory: doc.subCategory,
    playbackUrl: doc.playbackUrl,
    drmEnabled: !!doc.drmEnabled,
    drmProvider: doc.drmProvider,
    drmLicenseUrl: doc.drmLicenseUrl,
    drmHeaders: doc.drmHeaders || {},
    cookieValue: doc.cookieValue || null,
    referrer: doc.referrer || null,
    origin: doc.origin || null,
    customUserAgent: doc.customUserAgent || null,
    thumbnailUrl: doc.thumbnailUrl || null,
    isPremium: !!doc.isPremium,
    isActive: !!doc.isActive
  };
}

function normalizeContent(doc) {
  if (!doc) return null;
  return {
    contentId: doc.contentId,
    title: doc.title,
    description: doc.description,
    type: doc.type,
    category: doc.category,
    subCategory: doc.subCategory,
    streamUrl: doc.streamUrl,
    drmEnabled: !!doc.drmEnabled,
    drmProvider: doc.drmProvider,
    drmLicenseUrl: doc.drmLicenseUrl,
    drmHeaders: doc.drmHeaders || {},
    cookieValue: doc.cookieValue || null,
    referrer: doc.referrer || null,
    origin: doc.origin || null,
    customUserAgent: doc.customUserAgent || null,
    posterUrl: doc.posterUrl || null,
    isPremium: !!doc.isPremium,
    isActive: !!doc.isActive
  };
}

// Routes

// Health
app.get('/', (req, res) => {
  res.json({ ok: true, now: new Date() });
});

// Banners
app.get('/api/banners', async (req, res) => {
  try {
    const banners = await Banner.find({ isActive: true }).sort({ position: 1, createdAt: -1 }).limit(50);
    res.json({ banners: banners.map(normalizeBanner) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load banners' });
  }
});

// Subcategories for a parent category
app.get('/api/subcategories', async (req, res) => {
  try {
    const parent = (req.query.parent || '').toLowerCase();
    if (!parent) return res.status(400).json({ error: 'parent query required' });
    const subs = await SubCategory.find({ parentCategory: parent, isActive: true }).sort({ order: 1 });
    res.json({ subcategories: subs.map(s => ({ name: s.name, key: s.key, order: s.order })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load subcategories' });
  }
});

// Channels (filter by category, subCategory)
app.get('/api/channels', async (req, res) => {
  try {
    const q = {};
    if (req.query.category) q.category = req.query.category.toLowerCase();
    if (req.query.subCategory) q.subCategory = req.query.subCategory;
    if (req.query.isPremium !== undefined) q.isPremium = req.query.isPremium === 'true';
    q.isActive = true;

    const list = await Channel.find(q).limit(200).sort({ createdAt: -1 });
    res.json({ channels: list.map(normalizeChannel) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

// Content (filter by category, subCategory)
app.get('/api/content', async (req, res) => {
  try {
    const q = {};
    if (req.query.category) q.category = req.query.category.toLowerCase();
    if (req.query.subCategory) q.subCategory = req.query.subCategory;
    if (req.query.isPremium !== undefined) q.isPremium = req.query.isPremium === 'true';
    q.isActive = true;

    const list = await Content.find(q).limit(200).sort({ createdAt: -1 });
    res.json({ content: list.map(normalizeContent) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load content' });
  }
});

// Trending: random channels and contents (separate arrays)
app.get('/api/trending', async (req, res) => {
  try {
    const sampleSize = parseInt(req.query.size || '8', 10);
    const channels = await Channel.aggregate([
      { $match: { category: 'trending', isActive: true } },
      { $sample: { size: sampleSize } }
    ]);
    const contents = await Content.aggregate([
      { $match: { category: 'trending', isActive: true } },
      { $sample: { size: sampleSize } }
    ]);
    res.json({
      channels: channels.map(normalizeChannel),
      content: contents.map(normalizeContent)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load trending' });
  }
});

// Start server
// Start server
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`✅ Server is running and accessible on your network`);
  console.log(`   Connect at: http://192.168.1.181:${PORT}`);
});