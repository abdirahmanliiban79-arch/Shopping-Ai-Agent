import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

function extractDbName(uri: string | undefined): string {
  const match = uri?.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/);
  return match?.[1] || "shoppingAgent";
}

export const DB_NAME = extractDbName(MONGODB_URI);

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: { conn: mongoose.Connection | null; promise: Promise<mongoose.Connection> | null } | undefined;
}

const cache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function connectDB(): Promise<mongoose.Connection> {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not defined in environment variables");
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, { dbName: DB_NAME })
      .then((m) => m.connection);
  }
  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    throw err;
  }
  return cache.conn;
}