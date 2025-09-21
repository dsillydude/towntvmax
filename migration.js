const mongoose = require('mongoose');
require('dotenv').config();

// --- Configuration --------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://...';

// --- Database Model (using the NEW schema) --------------------------------
const channelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mainCategory: { type: String, required: true },
  subCategory: { type: String, required: true },
  category: { type: String }, // Old field for finding documents to migrate
}, { strict: false, timestamps: true });

const Channel = mongoose.model('Channel', channelSchema);

// --- Migration Logic ------------------------------------------------------

// UPDATED MAPPING BASED ON YOUR INSTRUCTIONS
const categoryMapping = {
  mziki:      { main: 'Trending', sub: 'Zinazotrend bongo' },
  mengineyo:  { main: 'Trending', sub: 'Zinazotrend Mbele' },
  burudani:   { main: 'Series',   sub: 'Tahmthilia' },
  sports:     { main: 'Sports',   sub: 'Mpira wa ndani' },
};

async function runMigration() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected successfully.');

  try {
    // 1. Find all documents that still have the old 'category' field.
    const channelsToMigrate = await Channel.find({
      category: { $exists: true },
      mainCategory: { $exists: false }
    });

    if (channelsToMigrate.length === 0) {
      console.log('✅ No channels to migrate. Your database is already up to date.');
      return;
    }

    console.log(`Found ${channelsToMigrate.length} channels to migrate...`);

    // 2. Prepare a bulk update operation.
    const bulkOperations = channelsToMigrate.map(channel => {
      const oldCategory = channel.category;
      const mapping = categoryMapping[oldCategory] || { main: 'General', sub: 'Uncategorized' };
      
      console.log(`- Migrating "${channel.name}": ${oldCategory} -> ${mapping.main} / ${mapping.sub}`);

      return {
        updateOne: {
          filter: { _id: channel._id },
          update: {
            $set: {
              mainCategory: mapping.main,
              subCategory: mapping.sub,
            },
            $unset: {
              category: "" // Removes the old 'category' field
            }
          }
        }
      };
    });

    // 3. Execute the bulk update.
    const result = await Channel.bulkWrite(bulkOperations);
    console.log('\n--- Migration Result ---');
    console.log(`Matched documents: ${result.matchedCount}`);
    console.log(`Modified documents: ${result.modifiedCount}`);
    console.log('✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ An error occurred during migration:', error);
  } finally {
    // 4. Ensure the database connection is closed.
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

// --- Run the script -------------------------------------------------------
runMigration();