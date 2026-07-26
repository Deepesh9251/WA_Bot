const fs = require('fs');
const path = require('path');

function pruneBrowserCache() {
  try {
    const authDir = './.wwebjs_auth';
    if (!fs.existsSync(authDir)) return;

    const cacheNames = [
      'Cache',
      'Code Cache',
      'GPUCache',
      'ShaderCache',
      'CacheStorage',
      'ScriptCache',
    ];

    function cleanDir(dirPath) {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (cacheNames.includes(entry.name)) {
            try {
              fs.rmSync(fullPath, { recursive: true, force: true });
            } catch (e) {}
          } else {
            cleanDir(fullPath);
          }
        }
      }
    }

    cleanDir(authDir);
  } catch (e) {}
}

/**
 * Custom MongoStore implementation for whatsapp-web.js RemoteAuth.
 * Fixes the upstream wwebjs-mongo bug where openDownloadStreamByName downloads
 * the oldest file in GridFS instead of the newest uploaded session zip.
 */
class CustomMongoStore {
  constructor({ mongoose } = {}) {
    if (!mongoose) {
      throw new Error('A valid Mongoose instance is required for CustomMongoStore.');
    }
    this.mongoose = mongoose;
  }

  async sessionExists(options) {
    try {
      const collection = this.mongoose.connection.db.collection(`whatsapp-${options.session}.files`);
      const count = await collection.countDocuments();
      return count > 0;
    } catch (err) {
      return false;
    }
  }

  async save(options) {
    // Prune useless Chromium cache files before compressing/uploading to keep RAM < 200MB
    pruneBrowserCache();

    const bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`,
    });

    const targetZip = `${options.session}.zip`;

    await new Promise((resolve, reject) => {
      fs.createReadStream(targetZip)
        .pipe(bucket.openUploadStream(targetZip))
        .on('error', (err) => reject(err))
        .on('finish', () => resolve());
    });

    options.bucket = bucket;
    await this.#purgeOldVersions(options);
  }

  async extract(options) {
    const bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`,
    });

    // CRITICAL FIX: Sort by uploadDate descending (-1) to guarantee downloading the LATEST session zip
    const documents = await bucket
      .find({ filename: `${options.session}.zip` })
      .sort({ uploadDate: -1 })
      .toArray();

    if (!documents || documents.length === 0) {
      throw new Error(`No session file found in MongoDB GridFS for ${options.session}`);
    }

    const latestDoc = documents[0];

    return new Promise((resolve, reject) => {
      bucket
        .openDownloadStream(latestDoc._id)
        .pipe(fs.createWriteStream(options.path))
        .on('error', (err) => reject(err))
        .on('finish', () => {
          pruneBrowserCache();
          resolve();
        });
    });
  }

  async delete(options) {
    try {
      const bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
        bucketName: `whatsapp-${options.session}`,
      });

      const documents = await bucket
        .find({ filename: `${options.session}.zip` })
        .toArray();

      for (const doc of documents) {
        await bucket.delete(doc._id);
      }
    } catch (err) {
      // Ignore cleanup errors if bucket is empty
    }
  }

  async #purgeOldVersions(options) {
    try {
      const documents = await options.bucket
        .find({ filename: `${options.session}.zip` })
        .sort({ uploadDate: -1 })
        .toArray();

      // Keep only the newest document (index 0), delete all older versions
      if (documents.length > 1) {
        for (let i = 1; i < documents.length; i++) {
          await options.bucket.delete(documents[i]._id);
        }
      }
    } catch (err) {
      // Non-fatal if purge fails
    }
  }
}

module.exports = CustomMongoStore;
