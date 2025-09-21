/*
 * Town Tv Max Backend — Stricter UUID Version
 * --------------------------------------------------------------
 * Patches applied:
 * ... (previous patches)
 * 30) APPLIED: Removed all deviceId and phoneNumber fallbacks.
 * - Webhook and status endpoints now ONLY use installationId.
 * - Removed legacy /api/users/log-install endpoint.
 * - System is now strictly based on unique installationId (UUID).
 * 31) APPLIED: Replaced single category with mainCategory and subCategory.
 * - Updated channelSchema for the new fields.
 * - Updated channelValidationSchema for the new fields.
 * - Upgraded GET /api/channels to support search and filtering.
 */

const express = require('express');
const mongoose = require('mongoose');
const Joi = require('joi');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// --- Middleware ------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.set('trust proxy', true);

// --- MongoDB Connection ----------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI ||
  'mongodb+srv://townmaxdb:2016Brianna@townmax.fze1itu.mongodb.net/townmax?retryWrites=true&w=majority&appName=townmax';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- Helpers ---------------------------------------------------------------
function transformDoc(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  obj.id = obj._id?.toString?.() || obj.id;
  delete obj._id;
  delete obj.__v;
  return obj;
}
function transformArray(docs) {
  return (docs || []).map(transformDoc);
}

function formatPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('255') && digits.length === 12) {
    return '0' + digits.substring(3);
  }
  if ((digits.startsWith('7') || digits.startsWith('6')) && digits.length === 9) {
    return '0' + digits;
  }
  if (digits.startsWith('07') && digits.length === 10) {
    return digits;
  }
  return phone;
}


// --- Schemas & Models ------------------------------------------------------
const channelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  channelId: { type: String, required: true, unique: true },
  playbackUrl: { type: String, required: true },
  drm: {
    enabled: { type: Boolean, default: false },
    provider: { type: String, enum: ['clearkey', 'none', 'widevine'], default: 'none' },
    key: { type: String, default: '' },
    licenseServer: { type: String, default: '' },
  },
  playbackHeaders: { type: Map, of: String, default: {} },
  mainCategory: { type: String, required: true, default: 'General' },
  subCategory: { type: String, required: true, default: 'Uncategorized' },
  description: { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },
  status: { type: Boolean, default: true },
  tag: { type: String, default: '' },
  position: { type: Number, default: 999 },
  
}, { timestamps: true });

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  description: { type: String, default: '' },
}, { timestamps: true });

const sliderSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  image_url: { type: String, required: true },
  action_url: { type: String, default: '' },
  is_active: { type: Boolean, default: true },
  order_index: { type: Number, default: 0 },
  type: {
    type: String,
    enum: ['hero', 'promo'],
    default: 'hero'
  }
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  target_audience: { type: String, enum: ['all', 'paid', 'free'], default: 'all' },
  status: { type: String, enum: ['draft', 'sent', 'scheduled'], default: 'draft' },
  sent_count: { type: Number, default: 0 },
  scheduled_at: { type: Date },
  sent_at: { type: Date },
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String },
  installationId: { type: String, unique: true, sparse: true }, // ✅ Main unique identity (UUID)
  deviceId: { type: String, index: true, sparse: true },        // For analytics/info only
  phoneNumber: { type: String, unique: true, sparse: true },   // Can be linked to one user
  is_premium: { type: Boolean, default: false },
  subscriptionEndDate: { type: Date },
  last_login: { type: Date, default: Date.now },
  username: { type: String, sparse: true },
  email: { type: String, sparse: true },
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true },
  name: { type: String, required: true },
  packageTitle: { type: String },
  price: { type: Number },
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'], default: 'PENDING' },
  token: { type: String },
  deviceId: { type: String }, // For analytics/info only
  installationId: { type: String }, // The ONLY link to a user
}, { timestamps: true });

const Channel = mongoose.model('Channel', channelSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Slider = mongoose.model('Slider', sliderSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- Validation Schemas ----------------------------------------------------
const channelValidationSchema = Joi.object({
  name: Joi.string().required(),
  channelId: Joi.string().required(),
  playbackUrl: Joi.string().uri().required(),
  drm: Joi.object({
    enabled: Joi.boolean(),
    provider: Joi.string().valid('clearkey', 'none', 'widevine'),
    key: Joi.string().allow(''),
    licenseServer: Joi.string().uri().allow(''),
  }),
  playbackHeaders: Joi.object().pattern(Joi.string(), Joi.string()),
  mainCategory: Joi.string().required(),
  subCategory: Joi.string().required(),
  description: Joi.string().allow(''),
  thumbnailUrl: Joi.string().uri().allow(''),
  status: Joi.boolean(),
  tag: Joi.string().allow(''),
  position: Joi.number(),
}).unknown(true);

const settingsValidationSchema = Joi.object({
  key: Joi.string().required(),
  value: Joi.string().required(),
  description: Joi.string().allow(''),
});

const sliderValidationSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().allow(''),
  image_url: Joi.string().uri().required(),
  action_url: Joi.string().uri().allow(''),
  is_active: Joi.boolean(),
  order_index: Joi.number(),
  type: Joi.string().valid('hero', 'promo'),
});

const notificationValidationSchema = Joi.object({
  title: Joi.string().required(),
  message: Joi.string().required(),
  target_audience: Joi.string().valid('all', 'paid', 'free'),
  scheduled_at: Joi.date().iso(),
});

// --- Enhanced In-Memory Settings Cache ------------------------------------
const settingsCache = {
  map: new Map(),
  lastLoadedAt: 0,
  ttlMs: Number(process.env.SETTINGS_CACHE_TTL_MS || 60_000),
};

async function hydrateSettingsCache() {
  console.log('🔄 Refreshing settings cache...');
  const all = await Settings.find({}).lean();
  settingsCache.map.clear();
  for (const s of all) settingsCache.map.set(s.key, s.value);
  settingsCache.lastLoadedAt = Date.now();
  console.log(`✅ Settings cache refreshed with ${settingsCache.map.size} keys`);
  return settingsCache.map.size;
}

async function ensureSettingsFresh() {
  const now = Date.now();
  if (now - settingsCache.lastLoadedAt > settingsCache.ttlMs) {
    try {
      await hydrateSettingsCache();
    } catch (err) {
      console.error('Settings cache refresh failed:', err.message);
    }
  }
}

async function getSetting(key, fallback = null) {
  await ensureSettingsFresh();
  if (settingsCache.map.has(key)) return settingsCache.map.get(key);
  const s = await Settings.findOne({ key }).lean();
  if (s) {
    settingsCache.map.set(s.key, s.value);
    return s.value;
  }
  return fallback;
}

function setSettingInCache(key, value) {
  settingsCache.map.set(key, value);
  console.log(`📝 Cache updated: ${key} = ${value}`);
}

function deleteSettingInCache(key) {
  settingsCache.map.delete(key);
  console.log(`🗑️ Cache deleted: ${key}`);
}

// --- Initialize Default Settings ------------------------------------------
async function initializeDefaultSettings() {
  try {
    const settingsCount = await Settings.countDocuments();
    if (settingsCount === 0) {
      const defaults = [
        { key: 'app_name', value: 'Town Tv Max', description: 'Application name' },
        { key: 'app_version', value: '1.0.0', description: 'Current app version' },
        { key: 'maintenance_mode', value: 'false', description: 'Enable maintenance mode' },
        { key: 'paywall_enabled', value: 'false', description: 'Enable paywall for streaming' },
        { key: 'trial_seconds', value: String(60), description: 'Free trial duration in seconds' },
        {
          key: 'subscription_packages',
          value: JSON.stringify([
            { name: 'Siku 1', price: 800, days: 1 },
            { name: 'Siku 3', price: 2000, days: 3 },
            { name: 'Wiki 1', price: 4000, days: 7 },
            { name: 'Mwezi 1', price: 20000, days: 30 },
          ]),
          description: 'Available subscription packages (JSON format)',
        },
        { key: 'whatsapp_link', value: 'https://wa.me/255745610606', description: 'Customer support WhatsApp link' },
      ];
      await Settings.insertMany(defaults);
      console.log('Default settings initialized');
    } else {
      const whatsappLink = await Settings.findOne({ key: 'whatsapp_link' });
      if (!whatsappLink) {
        await Settings.create({
          key: 'whatsapp_link',
          value: 'https://wa.me/0715123456',
          description: 'Customer support WhatsApp link',
        });
        console.log('Added missing whatsapp_link setting.');
      }
    }
  } catch (error) {
    console.error('Error initializing default settings:', error);
  }
}

initializeDefaultSettings()
  .then(() => hydrateSettingsCache())
  .then(count => console.log(`🚀 Settings cache initialized with ${count} keys (ttl=${settingsCache.ttlMs}ms)`))
  .catch(err => console.error('Initial settings cache hydrate failed:', err.message));

// --- PATCH: REMOVED LEGACY /api/users/log-install ENDPOINT ---
// This endpoint was based on deviceId and is no longer needed.
// All user creation is now handled by /api/auth/device-login.


// --- CHANNEL ROUTES --------------------------------------------------------
app.get('/api/channels', async (req, res) => {
  try {
    const { search, mainCategory, subCategory } = req.query;
    let query = {};

    // Handle search query
    if (search) {
      query.name = { $regex: search, $options: 'i' }; // Case-insensitive search on the 'name' field
    }

    // Handle category filters
    if (mainCategory) {
      query.mainCategory = mainCategory;
    }
    if (subCategory) {
      query.subCategory = subCategory;
    }
    
    const channels = await Channel.find(query).sort({ 
      position: 1,
      createdAt: -1
    });
    
    res.json({ channels: transformArray(channels) });
  } catch (error) {
    console.error('Failed to fetch channels:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

app.get('/api/channels/:id', async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ channel: transformDoc(channel) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

app.post('/api/channels', async (req, res) => {
  try {
    const { error } = channelValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const newChannel = new Channel(req.body);
    await newChannel.save();
    res.status(201).json({ message: 'Channel created successfully', channel: transformDoc(newChannel) });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: 'Channel ID already exists' });
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

app.put('/api/channels/:id', async (req, res) => {
  try {
    const { error } = channelValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const updatedChannel = await Channel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedChannel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ message: 'Channel updated successfully', channel: transformDoc(updatedChannel) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

app.delete('/api/channels/:id', async (req, res) => {
  try {
    const deletedChannel = await Channel.findByIdAndDelete(req.params.id);
    if (!deletedChannel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ message: 'Channel deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

app.post('/api/channels/:id/duplicate', async (req, res) => {
  try {
    const originalChannel = await Channel.findById(req.params.id).lean();
    if (!originalChannel) {
      return res.status(404).json({ error: 'Original channel not found' });
    }

    delete originalChannel._id;
    delete originalChannel.createdAt;
    delete originalChannel.updatedAt;
    originalChannel.name = `${originalChannel.name} (Copy)`;
    originalChannel.channelId = `${originalChannel.channelId}_${Date.now()}`;

    const newChannel = new Channel(originalChannel);
    await newChannel.save();

    res.status(201).json({
      message: 'Channel duplicated successfully',
      channel: transformDoc(newChannel),
    });
  } catch (error) {
    console.error('Duplicate channel error:', error);
    res.status(500).json({ error: 'Failed to duplicate channel' });
  }
});

app.post('/api/channels/:id/toggle', async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    channel.status = !channel.status;
    await channel.save();
    res.json({ message: 'Channel status toggled successfully', channel: transformDoc(channel) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle channel status' });
  }
});

app.post('/api/channels/batch', async (req, res) => {
  try {
    const { ids, action, status } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty ids array' });
    }

    let result;
    if (action === 'delete') {
      result = await Channel.deleteMany({ _id: { $in: ids } });
    } else if (action === 'updateStatus' && typeof status === 'boolean') {
      result = await Channel.updateMany({ _id: { $in: ids } }, { status });
    } else {
      return res.status(400).json({ error: 'Invalid action or missing status' });
    }

    res.json({
      success: true,
      message: `Batch ${action} completed successfully`,
      affected: result.deletedCount || result.modifiedCount || 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to perform batch operation' });
  }
});

// --- ENHANCED SETTINGS ROUTES ---------------------------------------------
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Settings.find({}).sort({ key: 1 });
    res.json({ settings: transformArray(settings) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.get('/api/settings/public', async (req, res) => {
  try {
    const settings = await Settings.find({}).sort({ key: 1 });
    const publicSettings = {};
    settings.forEach(setting => { publicSettings[setting.key] = setting.value; });
    res.json(publicSettings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch public settings' });
  }
});

app.post('/api/settings/refresh-cache', async (req, res) => {
  try {
    const count = await hydrateSettingsCache();
    res.json({
      message: 'Cache refreshed successfully',
      count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh cache' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { error } = settingsValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const newSetting = new Settings(req.body);
    await newSetting.save();
    setSettingInCache(newSetting.key, newSetting.value);
    res.status(201).json({ message: 'Setting created successfully', setting: transformDoc(newSetting) });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: 'Setting key already exists' });
    res.status(500).json({ error: 'Failed to create setting' });
  }
});

app.put('/api/settings/:id', async (req, res) => {
  try {
    const { value, description } = req.body;
    const updateData = {};
    if (value !== undefined) updateData.value = value;
    if (description !== undefined) updateData.description = description;

    const updatedSetting = await Settings.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!updatedSetting) return res.status(404).json({ error: 'Setting not found' });

    if (updatedSetting.key && updatedSetting.value !== undefined) {
      setSettingInCache(updatedSetting.key, updatedSetting.value);
    }

    res.json({ message: 'Setting updated successfully', setting: transformDoc(updatedSetting) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

app.delete('/api/settings/:id', async (req, res) => {
  try {
    const deletedSetting = await Settings.findByIdAndDelete(req.params.id);
    if (!deletedSetting) return res.status(404).json({ error: 'Setting not found' });
    deleteSettingInCache(deletedSetting.key);
    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

app.post('/api/settings/paywall/toggle', async (req, res) => {
  try {
    console.log('🔄 Paywall toggle requested');
    let s = await Settings.findOne({ key: 'paywall_enabled' });
    if (!s) return res.status(404).json({ error: 'paywall_enabled setting not found' });

    const oldValue = s.value;
    s.value = s.value === 'true' ? 'false' : 'true';
    await s.save();

    setSettingInCache('paywall_enabled', s.value);

    await hydrateSettingsCache();

    console.log(`✅ Paywall toggled: ${oldValue} → ${s.value}`);

    res.json({
      key: 'paywall_enabled',
      value: s.value,
      previous_value: oldValue,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('❌ Toggle paywall error:', err.message);
    res.status(500).json({ error: 'Failed to toggle paywall' });
  }
});

app.get('/api/test/paywall-status', async (req, res) => {
  try {
    const paywallEnabled = await getSetting('paywall_enabled', 'false');
    const trialSeconds = await getSetting('trial_seconds', '0');

    res.json({
      paywall_enabled: paywallEnabled,
      trial_seconds: trialSeconds,
      cache_size: settingsCache.map.size,
      cache_last_loaded: new Date(settingsCache.lastLoadedAt).toISOString(),
      cache_ttl_ms: settingsCache.ttlMs,
      cache_contents: Object.fromEntries(settingsCache.map)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- SLIDERS ROUTES --------------------------------------------------------
app.get('/api/sliders', async (req, res) => {
  try {
    const sliders = await Slider.find({}).sort({ order_index: 1, createdAt: -1 });
    res.json({ sliders: transformArray(sliders) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sliders' });
  }
});

app.get('/api/sliders/public', async (req, res) => {
  try {
    const query = { is_active: true };
    if (req.query.type) {
      query.type = req.query.type;
    }

    const sliders = await Slider.find(query).sort({ order_index: 1, createdAt: -1 });
    res.json({ sliders: transformArray(sliders) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch public sliders' });
  }
});

app.post('/api/sliders', async (req, res) => {
  try {
    const { error } = sliderValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    if (!req.body.order_index) {
      const maxOrder = await Slider.findOne({}).sort({ order_index: -1 });
      req.body.order_index = (maxOrder?.order_index || 0) + 1;
    }

    const newSlider = new Slider(req.body);
    await newSlider.save();
    res.status(201).json({ message: 'Slider created successfully', slider: transformDoc(newSlider) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create slider' });
  }
});

app.put('/api/sliders/:id', async (req, res) => {
  try {
    const { error } = sliderValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const updatedSlider = await Slider.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedSlider) return res.status(404).json({ error: 'Slider not found' });

    res.json({ message: 'Slider updated successfully', slider: transformDoc(updatedSlider) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update slider' });
  }
});

app.delete('/api/sliders/:id', async (req, res) => {
  try {
    const deletedSlider = await Slider.findByIdAndDelete(req.params.id);
    if (!deletedSlider) return res.status(404).json({ error: 'Slider not found' });
    res.json({ message: 'Slider deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete slider' });
  }
});

app.post('/api/sliders/:id/toggle', async (req, res) => {
  try {
    const slider = await Slider.findById(req.params.id);
    if (!slider) return res.status(404).json({ error: 'Slider not found' });

    slider.is_active = !slider.is_active;
    await slider.save();

    res.json({ message: 'Slider status toggled successfully', slider: transformDoc(slider) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle slider status' });
  }
});

// --- NOTIFICATIONS ROUTES --------------------------------------------------
app.get('/api/notifications', async (req, res) => {
  try {
    const notifications = await Notification.find({}).sort({ createdAt: -1 });
    res.json({ notifications: transformArray(notifications) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const deletedNotification = await Notification.findByIdAndDelete(req.params.id);
    if (!deletedNotification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.post('/api/notifications', async (req, res) => {
  try {
    const { error } = notificationValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const newNotification = new Notification(req.body);
    if (req.body.scheduled_at) newNotification.status = 'scheduled';

    await newNotification.save();
    res.status(201).json({ message: 'Notification created successfully', notification: transformDoc(newNotification) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

app.put('/api/notifications/:id', async (req, res) => {
  try {
    const { error } = notificationValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const updatedNotification = await Notification.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedNotification) return res.status(404).json({ error: 'Notification not found' });

    res.json({ message: 'Notification updated successfully', notification: transformDoc(updatedNotification) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const deletedNotification = await Notification.findByIdAndDelete(req.params.id);
    if (!deletedNotification) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.post('/api/notifications/:id/send', async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });

    let targetCount = 0;
    const totalUsers = await User.countDocuments();

    if (notification.target_audience === 'all') {
      targetCount = totalUsers;
    } else if (notification.target_audience === 'paid') {
      targetCount = await User.countDocuments({ is_premium: true });
    } else if (notification.target_audience === 'free') {
      targetCount = await User.countDocuments({ is_premium: false });
    }

    notification.status = 'sent';
    notification.sent_at = new Date();
    notification.sent_count = targetCount;
    await notification.save();

    res.json({ message: 'Notification sent successfully', notification: transformDoc(notification), sent_to: targetCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// --- STATS ROUTES ----------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const totalUsers = await User.countDocuments();
    const paidUsers = await User.countDocuments({ is_premium: true });
    const freeUsers = totalUsers - paidUsers;
    const totalChannels = await Channel.countDocuments();
    const activeChannels = await Channel.countDocuments({ status: true });

    const newUsersToday = await User.countDocuments({ createdAt: { $gte: startOfToday } });
    const newUsersThisWeek = await User.countDocuments({ createdAt: { $gte: startOfWeek } });
    const newUsersThisMonth = await User.countDocuments({ createdAt: { $gte: startOfMonth } });

    const activeUsers = Math.floor(totalUsers * 0.3);

    const subscriptionPrice = 9.99;
    const revenue = {
      today: paidUsers * subscriptionPrice * 0.1,
      thisWeek: paidUsers * subscriptionPrice * 0.7,
      thisMonth: paidUsers * subscriptionPrice * 3.0,
      total: paidUsers * subscriptionPrice * 12.0,
    };

    const channels = await Channel.find({ status: true }).limit(5);
    const topChannels = channels.map((channel, index) => ({
      id: channel._id.toString(),
      name: channel.name,
      viewCount: Math.max(1000 - index * 200, 100),
      uniqueViewers: Math.max(500 - index * 100, 50),
    }));

    const userGrowth = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      userGrowth.push({
        date: date.toISOString().split('T')[0],
        totalUsers: Math.max(totalUsers - i * 10, 0),
        paidUsers: Math.max(paidUsers - i * 2, 0),
      });
    }

    res.json({
      totalUsers, paidUsers, freeUsers, activeUsers, newUsersToday, newUsersThisWeek,
      newUsersThisMonth, totalChannels, activeChannels, revenue, topChannels, userGrowth,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/stats/dashboard', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const paidUsers = await User.countDocuments({ is_premium: true });
    const totalChannels = await Channel.countDocuments();
    const activeChannels = await Channel.countDocuments({ status: true });

    res.json({ totalUsers, paidUsers, totalChannels, activeChannels });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// --- Enhanced Paywall Middleware (uses settings cache) --------------------
async function enforcePaywall(req, res, next) {
  try {
    const paywallEnabledStr = await getSetting('paywall_enabled', 'false');
    const trialSecondsStr = await getSetting('trial_seconds', '0');

    const paywallEnabled = paywallEnabledStr === 'true';
    const trialSeconds = parseInt(trialSecondsStr || '0', 10);

    console.log(`🔒 Paywall check: enabled=${paywallEnabled}, trial=${trialSeconds}s`);

    if (!paywallEnabled) {
      console.log('✅ Paywall disabled - allowing access');
      return next();
    }

    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ error: 'Paywall enabled. Please log in.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    } catch {
      console.log('❌ Invalid token');
      return res.status(401).json({ error: 'Invalid token.' });
    }

    const userId = payload.user?.id;
    const user = await User.findById(userId);
    if (!user) {
      console.log('❌ User not found');
      return res.status(401).json({ error: 'User not found.' });
    }

    if (user.is_premium && user.subscriptionEndDate > Date.now()) {
      console.log('✅ Premium user - allowing access');
      return next();
    }

    if (trialSeconds > 0) {
      const accountAgeSeconds = (Date.now() - user.createdAt.getTime()) / 1000;
      if (accountAgeSeconds <= trialSeconds) {
        console.log(`✅ Trial user - allowing access (${Math.ceil(trialSeconds - accountAgeSeconds)}s remaining)`);
        return next();
      }
    }

    console.log('❌ Paywall blocking access');
    return res.status(403).json({ error: 'Paywall active. Please subscribe.' });
  } catch (err) {
    console.error('Paywall enforcement error:', err);
    res.status(500).json({ error: 'Paywall check failed.' });
  }
}

// --- PUBLIC ROUTES (paywall-protected where relevant) ----------------------
app.get('/api/public/channels', enforcePaywall, async (req, res) => {
  try {
    const { category, mainCategory, subCategory } = req.query; // Keep `category` for backward compatibility if needed.
    let query = { status: true };
    
    // New logic
    if (mainCategory) query.mainCategory = mainCategory;
    if (subCategory) query.subCategory = subCategory;

    // Old logic (can be removed if clients are updated)
    if (category && ['sports', 'mziki', 'mengineyo', 'burudani'].includes(category)) {
      // A simple mapping could be done here if necessary, e.g.
      // if (category === 'sports') query.mainCategory = 'Sports';
    }
    
    const channels = await Channel.find(query).sort({ 
      position: 1,
      createdAt: -1
    });
    
    res.json({ channels: transformArray(channels) });
  } catch (error) {
    console.error('Failed to fetch public channels:', error);
    res.status(500).json({ error: 'Failed to fetch public channels' });
  }
});

app.get('/api/public/channels/:channelId', enforcePaywall, async (req, res) => {
  try {
    const channel = await Channel.findOne({ 
      channelId: req.params.channelId, 
      status: true 
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ channel: transformDoc(channel) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

app.get('/api/public/packages', async (req, res) => {
  try {
    const raw = await getSetting('subscription_packages');
    if (!raw) return res.status(404).json({ error: 'Subscription packages not configured.' });
    try {
      res.json(JSON.parse(raw));
    } catch {
      res.status(500).json({ error: 'Failed to parse subscription packages.' });
    }
  } catch (error) {
    console.error('Failed to fetch packages:', error);
    res.status(500).json({ error: 'Failed to fetch subscription packages.' });
  }
});

app.get('/api/public/notifications', async (req, res) => {
  try {
    const notifications = await Notification.find({ status: 'sent' }).sort({ sent_at: -1 });
    res.json({ notifications: transformArray(notifications) });
  } catch (error) {
    console.error('Failed to fetch public notifications:', error);
    res.status(500).json({ error: 'Failed to fetch public notifications.' });
  }
});

// --- SUBSCRIBE & PAYMENT ---------------------------------------------------
app.post('/api/subscribe/initiate-payment', async (req, res) => {
  try {
    // --- PATCH: installationId is now the most critical piece of data ---
    const { name, phoneNumber, package: packageTitle, installationId } = req.body;
    
    // Ensure the client has sent the installationId
    if (!name || !phoneNumber || !packageTitle || !installationId) {
      return res.status(400).json({ error: 'Name, phone number, package, and installationId are required.' });
    }

    const packSettingRaw = await getSetting('subscription_packages');
    if (!packSettingRaw) return res.status(500).json({ error: 'Subscription packages not configured on server.' });

    let packages = {};
    try {
      const parsed = JSON.parse(packSettingRaw);
      parsed.forEach(p => { packages[p.name.toLowerCase()] = { price: p.price, days: p.days }; });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to parse subscription packages on server.' });
    }

    const selectedPackage = packages[packageTitle?.toLowerCase()];
    if (!selectedPackage) {
        console.error(`Invalid package selected: ${packageTitle}. Available:`, Object.keys(packages));
        return res.status(400).json({ error: 'Invalid package selected' });
    }

    const amount = Number(selectedPackage.price);
    const orderId = uuidv4();

    const tx = new Transaction({
      orderId,
      phoneNumber,
      name,
      packageTitle,
      price: amount,
      status: 'PENDING',
      installationId: installationId, // This is the crucial link to the user
      // deviceId is no longer needed to find the user
    });
    await tx.save();

    res.status(200).json({ orderId, message: 'Request received. Start polling.' });

    const backendURL = process.env.BACKEND_URL || `https://towntvmax.onrender.com`;
    const zenoPayload = {
      order_id: orderId,
      buyer_name: name,
      buyer_phone: formatPhone(phoneNumber),
      buyer_email: 'noemail@burudani.app',
      amount: amount,
      webhook_url: `${backendURL}/api/webhooks/zenopay`,
    };

    setImmediate(async () => {
      try {
        const url = process.env.ZENOPAY_API_URL;
        const apiKey = process.env.ZENOPAY_API_KEY;
        if (!url || !apiKey) {
          console.error('ZENOPAY credentials missing');
          await Transaction.updateOne({ orderId }, { status: 'FAILED' }).exec();
          return;
        }

        const zRes = await axios.post(url, zenoPayload, {
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          timeout: 15_000,
          validateStatus: () => true,
        });

        if (zRes.status >= 200 && zRes.status < 300) {
          console.log('✅ Payment gateway request acknowledged:', zRes.data);
        } else {
          console.error('❌ Zenopay non-2xx:', zRes.status, zRes.data);
          await Transaction.updateOne({ orderId }, { status: 'FAILED' }).exec();
        }
      } catch (apiErr) {
        const msg = apiErr?.response?.data || apiErr.message;
        console.error('❌ Payment gateway API call failed:', msg);
        try { await Transaction.updateOne({ orderId }, { status: 'FAILED' }).exec(); } catch {}
      }
    });
  } catch (error) {
    console.error('Payment initiation error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initiate payment.' });
    }
  }
});

// --- PATCH START: Webhook now ONLY uses installationId ---
app.post('/api/webhooks/zenopay', async (req, res) => {
  try {
    const { order_id, payment_status } = req.body || {};
    console.log(`[ZenoPay] Webhook received: order_id=${order_id}, status=${payment_status}`);

    const tx = await Transaction.findOne({ orderId: order_id });
    if (!tx) {
      console.log(`Webhook ignored: Transaction with orderId ${order_id} not found.`);
      return res.status(200).send('Ignored: Transaction not found');
    }

    if (payment_status === 'COMPLETED') {
      let durationDays = 30;
      try {
        const packRaw = await getSetting('subscription_packages');
        if (packRaw) {
          const packages = JSON.parse(packRaw);
          const matched = packages.find(
            (p) => p.name.toLowerCase() === tx.packageTitle.toLowerCase()
          );
          if (matched && matched.days) {
            durationDays = matched.days;
          }
        }
      } catch (e) {
        console.error("Could not parse subscription packages for duration.", e);
      }

      const now = new Date();
      
      // Find the user ONLY by the installationId from the transaction.
      // All fallback logic has been removed.
      const existingUser = tx.installationId 
        ? await User.findOne({ installationId: tx.installationId }) 
        : null;

      if (existingUser) {
        console.log(`Found user by installationId: ${tx.installationId}`);
      }
      
      let userToSign;

      if (existingUser) {
        console.log(`Upgrading existing user: ${existingUser.id}`);
        const baseDate =
          existingUser.subscriptionEndDate && existingUser.subscriptionEndDate > now
            ? existingUser.subscriptionEndDate
            : now;
        const newEndDate = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

        existingUser.is_premium = true;
        existingUser.subscriptionEndDate = newEndDate;
        if (tx.name) existingUser.name = tx.name;
        
        // This logic remains to prevent a crash if a new user tries to pay
        // with a phone number that's already linked to a different account.
        let shouldUpdatePhoneNumber = !existingUser.phoneNumber && tx.phoneNumber;
        if (shouldUpdatePhoneNumber) {
            const phoneOwner = await User.findOne({ phoneNumber: tx.phoneNumber });
            if (phoneOwner && phoneOwner.id !== existingUser.id) {
                console.warn(`Phone number ${tx.phoneNumber} is already linked to user ${phoneOwner.id}. Upgrading user ${existingUser.id} without changing phone number.`);
                shouldUpdatePhoneNumber = false;
            }
        }
        if (shouldUpdatePhoneNumber) {
            existingUser.phoneNumber = tx.phoneNumber;
        }
        
        await existingUser.save();
        console.log(`[ZenoPay] Extended user ${existingUser.id} until ${existingUser.subscriptionEndDate?.toISOString?.()}`);

        userToSign = existingUser;
      } else {
        // This block now only runs if the installationId from the payment
        // does not match any user in the database. This implies a new user.
        console.log(`Creating new premium user for installationId ${tx.installationId}`);
        const newEndDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
        
        const newUser = await User.create({
          name: tx.name || 'New User',
          phoneNumber: tx.phoneNumber,
          installationId: tx.installationId,
          is_premium: true,
          subscriptionEndDate: newEndDate,
        });
        userToSign = newUser;
        console.log(`[ZenoPay] Created premium user ${userToSign.id} (installationId=${tx.installationId})`);
      }

      const token = jwt.sign(
        { user: { id: userToSign.id } },
        process.env.JWT_SECRET || 'your_jwt_secret',
        { expiresIn: `${durationDays}d` }
      );

      tx.status = 'COMPLETED';
      tx.token = token;
      await tx.save();
      console.log(`✅ Successfully processed COMPLETED webhook for orderId ${order_id}`);

    } else if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(payment_status)) {
        tx.status = payment_status;
        await tx.save();
        console.log(`☑️ Successfully processed ${payment_status} webhook for orderId ${order_id}`);
    }

    res.status(200).send('Webhook processed');
  } catch (err) {
    console.error("Error processing webhook", err);
    res.status(500).send("Error processing webhook");
  }
});
// --- PATCH END ---


app.get('/api/subscribe/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const tx = await Transaction.findOne({ orderId });
    if (!tx) return res.status(404).json({ status: 'NOT_FOUND' });

    if (tx.status === 'COMPLETED') {
      // --- PATCH START: Status check now ONLY uses installationId ---
      // Find user exclusively by the installationId stored in the transaction.
      const user = tx.installationId 
        ? await User.findOne({ installationId: tx.installationId }) 
        : null;
      // --- PATCH END ---

      return res.json({ status: 'COMPLETED', token: tx.token, user: transformDoc(user) });
    }
    
    return res.json({ status: tx.status });
  } catch(err) {
    console.error('Subscription status error:', err);
    res.status(500).json({ error: 'Failed to get subscription status.' });
  }
});

app.post('/api/subscribe/mock-complete/:orderId', async (req, res) => {
  if (process.env.ALLOW_MOCK_PAY !== 'true') {
    return res.status(403).json({ error: 'Mocking is disabled' });
  }

  try {
    const { orderId } = req.params;
    const tx = await Transaction.findOne({ orderId });
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const webhookPayload = {
      order_id: orderId,
      payment_status: 'COMPLETED',
      buyer_phone: tx.phoneNumber
    };

    req.url = '/api/webhooks/zenopay';
    req.method = 'POST';
    req.body = webhookPayload;

    app._router.handle(req, res, () => {});

  } catch (e) {
    console.error('Mock completion error:', e.message);
    if (!res.headersSent) {
       res.status(500).json({ error: 'Failed to mock-complete payment' });
    }
  }
});

// --- Health & Server Start -------------------------------------------------
app.get('/health', (req, res) => res.json({ ok: true, app: 'Town Tv Max' }));

app.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find({ status: 'sent' }).sort({ sent_at: -1 }).limit(10);
    res.json({
      message: 'Town Tv Max Backend API',
      notifications: transformArray(notifications),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      message: 'Town Tv Max Backend API',
      notifications: [],
      error: 'Failed to fetch notifications'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Town Tv Max Backend server running on port ${PORT}`);
});

module.exports = app;

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

app.post('/api/auth/device-login', async (req, res) => {
  try {
    const { installationId, deviceId } = req.body;

    if (!installationId) {
      return res.status(400).json({ error: 'installationId is required' });
    }

    let user = await User.findOne({ installationId });

    if (user) {
      // User exists, update last login and deviceId (for analytics)
      user.deviceId = deviceId; 
      user.last_login = new Date();
      await user.save();
    } else {
      // This is a new installation, create a new user.
      user = new User({
        installationId,
        deviceId, // Stored for info, not for auth
        last_login: new Date(),
        is_premium: false
      });
      await user.save();
    }

    const durationDays = 365;
    const token = jwt.sign(
      { user: { id: user.id } },
      JWT_SECRET,
      { expiresIn: `${durationDays}d` }
    );

    res.json({
      message: 'Login successful',
      user: transformDoc(user),
      token
    });

  } catch (error) {
    console.error('Unified device login error:', error);
    if (error.code === 11000) {
      // This will now only trigger if two requests try to create a user with the same
      // installationId at the exact same time. Highly unlikely, but good to handle.
      return res.status(500).json({ error: 'Duplicate key error. Please try again.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// --- USER MANAGEMENT ROUTES -----------------------------------------------
app.get('/api/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const search = req.query.search || '';

    const filter = {};

    if (status === 'paid') {
      filter.is_premium = true;
    } else if (status === 'free') {
      filter.is_premium = false;
    }

    if (search) {
      // Search remains flexible for admin purposes
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { deviceId: { $regex: search, $options: 'i' } },
        { installationId: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(filter);

    const response = {
      users: transformArray(users),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: transformDoc(user) });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

const manualUpgradeValidation = Joi.object({
  days: Joi.number().integer().min(1).required(),
});

app.post('/api/users/:id/upgrade-premium', async (req, res) => {
  try {
    const { error } = manualUpgradeValidation.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const { days } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const now = new Date();
    const baseDate = user.subscriptionEndDate && user.subscriptionEndDate > now
      ? user.subscriptionEndDate
      : now;

    const newEndDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

    user.is_premium = true;
    user.subscriptionEndDate = newEndDate;
    
    await user.save();

    console.log(`MANUAL UPGRADE: User ${user.id} upgraded for ${days} days. New expiry: ${newEndDate.toISOString()}`);

    const token = jwt.sign(
      { user: { id: user.id } },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: `${days}d` } 
    );

    res.json({ 
      message: 'User upgraded successfully', 
      user: transformDoc(user),
      token: token,
    });

  } catch (error) {
    console.error('Manual upgrade error:', error);
    res.status(500).json({ error: 'Failed to upgrade user' });
  }
});


app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, phoneNumber, is_premium, subscriptionEndDate } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (is_premium !== undefined) updateData.is_premium = is_premium;
    if (subscriptionEndDate !== undefined) updateData.subscriptionEndDate = subscriptionEndDate;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: transformDoc(user) });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.user.id).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: transformDoc(user) });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});
