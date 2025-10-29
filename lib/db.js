let mongoose;
try {
  // Lazy load mongoose so the server can run without DB deps
  // If mongoose isn't installed, DB features will be disabled gracefully.
  mongoose = require("mongoose");
} catch (e) {
  mongoose = null;
}

// Support either MONGO_URL or MONGODB_URI env var names
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI;

let cached = global._mongoose;

if (!cached) {
  cached = global._mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  if (cached.conn) return cached.conn;
  
  if (!MONGO_URL || !mongoose) {
    console.warn("No MONGO_URL found. Database features will be limited.");
    return null;
  }
  
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGO_URL, { bufferCommands: false })
      .then((m) => m)
      .catch((err) => {
        console.warn("MongoDB connection failed:", err.message);
        return null;
      });
  }
  
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { dbConnect };