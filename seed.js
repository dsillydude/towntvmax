/*
 seed.js - seeds sample subcategories, channels, contents, banners into MongoDB.
 Usage:
   cp .env.example .env
   # edit .env to set MONGODB_URI and DB_NAME if needed
   npm install mongodb dotenv
   node seed.js
*/
require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'townmax';

if (!uri) {
  console.error('Please set MONGODB_URI in your .env file.');
  process.exit(1);
}

function keyFromName(name) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

async function seed() {
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    console.log('Connected to MongoDB for seeding');
    const db = client.db(dbName);
    const subColl = db.collection('subcategories');
    const channels = db.collection('channels');
    const contents = db.collection('contents');
    const banners = db.collection('banners');

    // Subcategories per your spec
    const subData = [
      { parentCategory: 'sports', name: 'All', key: keyFromName('All'), order: 0 },
      { parentCategory: 'sports', name: 'Mechi za Leo', key: keyFromName('Mechi za Leo'), order: 1 },
      { parentCategory: 'sports', name: 'Nje', key: keyFromName('Nje'), order: 2 },
      { parentCategory: 'sports', name: 'Ndani', key: keyFromName('Ndani'), order: 3 },

      { parentCategory: 'movies', name: 'All', key: keyFromName('All'), order: 0 },
      { parentCategory: 'movies', name: 'Bongo Movies', key: keyFromName('Bongo Movies'), order: 1 },
      { parentCategory: 'movies', name: 'Movies za Mbele', key: keyFromName('Movies za Mbele'), order: 2 },

      { parentCategory: 'series', name: 'All', key: keyFromName('All'), order: 0 },
      { parentCategory: 'series', name: 'Tamthilia', key: keyFromName('Tamthilia'), order: 1 },
      { parentCategory: 'series', name: 'Series za Mbele', key: keyFromName('Series za Mbele'), order: 2 }
    ];

    for (const s of subData) {
      await subColl.updateOne({ parentCategory: s.parentCategory, key: s.key }, { $set: s }, { upsert: true });
    }
    console.log('Seeded subcategories');

    // Channels
    const sampleChannels = [
      {
        channelId: 'ch_drm_wv',
        name: 'Test DRM Widevine Channel',
        description: 'A sample Widevine-protected channel (sports - Mechi za Leo)',
        category: 'sports',
        subCategory: keyFromName('Mechi za Leo'),
        playbackUrl: 'https://test-cdn.example.com/drm/wv/stream.mpd',
        drmEnabled: true,
        drmProvider: 'widevine',
        drmLicenseUrl: 'https://license-server.example.com/widevine',
        drmHeaders: { Authorization: 'Bearer testToken' },
        cookieValue: 'sessionid=abc123',
        customUserAgent: 'TownmaxPlayer/1.0',
        thumbnailUrl: '/uploads/channel1.jpg',
        isPremium: false,
        isActive: true,
        createdAt: new Date()
      },
      {
        channelId: 'ch_drm_pr',
        name: 'Test DRM PlayReady Channel',
        description: 'PlayReady channel requiring Origin and Referer headers (sports - Nje)',
        category: 'sports',
        subCategory: keyFromName('Nje'),
        playbackUrl: 'https://test-cdn.example.com/drm/pr/stream.mpd',
        drmEnabled: true,
        drmProvider: 'playready',
        drmLicenseUrl: 'https://license-server.example.com/playready',
        origin: 'https://example-origin.com',
        referrer: 'https://example-referrer.com/somepage',
        thumbnailUrl: '/uploads/channel2.jpg',
        isPremium: false,
        isActive: true,
        createdAt: new Date()
      },
      {
        channelId: 'ch_live_hls',
        name: 'Test Non-DRM Live HLS Channel',
        description: 'Regular HLS live channel (sports - Ndani)',
        category: 'sports',
        subCategory: keyFromName('Ndani'),
        playbackUrl: 'https://cdn.example.com/live/channel/index.m3u8',
        drmEnabled: false,
        thumbnailUrl: '/uploads/channel3.jpg',
        isPremium: false,
        isActive: true,
        createdAt: new Date()
      },
      // Trending-only channel
      {
        channelId: 'ch_trend_1',
        name: 'Trending Channel One',
        description: 'Exclusive trending channel',
        category: 'trending',
        subCategory: 'all',
        playbackUrl: 'https://cdn.example.com/live/trending1/index.m3u8',
        drmEnabled: false,
        thumbnailUrl: '/uploads/channel_trend.jpg',
        isPremium: false,
        isActive: true,
        createdAt: new Date()
      }
    ];

    for (const c of sampleChannels) {
      await channels.updateOne({ channelId: c.channelId }, { $set: c }, { upsert: true });
    }
    console.log('Seeded channels');

    // Contents
    const sampleContents = [
      {
        contentId: 'movie_ck_1',
        title: 'Test ClearKey Movie',
        description: 'ClearKey DRM protected movie',
        type: 'movie',
        category: 'movies',
        subCategory: keyFromName('Bongo Movies'),
        streamUrl: 'https://cdn.example.com/hls/clearkey/index.m3u8',
        drmEnabled: true,
        drmProvider: 'clearkey',
        drmLicenseUrl: 'https://license-server.example.com/clearkey',
        drmHeaders: { 'X-Custom': 'value' },
        posterUrl: '/uploads/movie1.jpg',
        isPremium: false,
        isActive: true,
        createdAt: new Date()
      },
      {
        contentId: 'movie_hls_1',
        title: 'Test HLS Movie',
        description: 'Non-DRM HLS movie (Movies za Mbele)',
        type: 'movie',
        category: 'movies',
        subCategory: keyFromName('Movies za Mbele'),
        streamUrl: 'https://cdn.example.com/hls/movie1/index.m3u8',
        drmEnabled: false,
        posterUrl: '/uploads/movie2.jpg',
        isPremium: false,
        isActive: true,
        createdAt: new Date()
      },
      // Trending content
      {
        contentId: 'content_trend_1',
        title: 'Trending Short One',
        description: 'Exclusive trending content',
        type: 'clip',
        category: 'trending',
        subCategory: 'all',
        streamUrl: 'https://cdn.example.com/hls/trending1/index.m3u8',
        drmEnabled: false,
        posterUrl: '/uploads/trend1.jpg',
        isPremium: false,
        isActive: true,
        createdAt: new Date()
      }
    ];

    for (const c of sampleContents) {
      await contents.updateOne({ contentId: c.contentId }, { $set: c }, { upsert: true });
    }
    console.log('Seeded contents');

    // Banners (vertical)
    const banner1 = { title: 'Vertical Promo 1', subtitle: 'Watch now', imageUrl: '/uploads/vertical1.jpg', actionType: 'channel', actionValue: 'ch_drm_wv', isVertical: true, isActive: true, position: 1, createdAt: new Date() };
    const banner2 = { title: 'Vertical Promo 2', subtitle: 'New Movie', imageUrl: '/uploads/vertical2.jpg', actionType: 'content', actionValue: 'movie_ck_1', isVertical: true, isActive: true, position: 2, createdAt: new Date() };
    await banners.updateOne({ title: banner1.title }, { $set: banner1 }, { upsert: true });
    await banners.updateOne({ title: banner2.title }, { $set: banner2 }, { upsert: true });
    console.log('Seeded banners');

    console.log('All seeding completed.');

  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    await client.close();
    process.exit(0);
  }
}

seed();