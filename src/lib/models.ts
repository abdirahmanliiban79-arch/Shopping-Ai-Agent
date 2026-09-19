import mongoose, { Schema } from "mongoose";
import type { SearchStatus, VerificationStatus } from "./types";

const ProductResultSchema = new Schema({
  searchId: { type: Schema.Types.ObjectId, ref: "SearchHistory", required: true, index: true },
  storeName: { type: String, required: true },
  storeDomain: { type: String, required: true },
  productUrl: { type: String, required: true },
  productTitle: { type: String },
  price: { type: Number, default: null },
  currency: { type: String, default: "USD" },
  inStock: { type: Boolean, default: null },
  confidenceScore: { type: Number, default: null },
  verificationStatus: {
    type: String,
    enum: ["VERIFIED", "UNVERIFIED_BLOCKED", "UNVERIFIED_UNCERTAIN", "FAILED"],
    required: true,
  },
  rank: { type: Number, default: null },
  reason: { type: String },
  createdAt: { type: Date, default: Date.now },
});

ProductResultSchema.index({ searchId: 1, rank: 1 });

export type ProductResultDoc = mongoose.InferSchemaType<typeof ProductResultSchema>;

export const ProductResult =
  (mongoose.models.ProductResult as mongoose.Model<ProductResultDoc>) ||
  mongoose.model<ProductResultDoc>("ProductResult", ProductResultSchema);

const SearchHistorySchema = new Schema({
  query: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  status: {
    type: String,
    enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
    default: "PENDING",
  },
  results: [{ type: Schema.Types.ObjectId, ref: "ProductResult" }],
  errorMessage: { type: String },
  cacheExpiresAt: { type: Date },
});

SearchHistorySchema.index({ query: 1, status: 1, cacheExpiresAt: -1 });

export type SearchHistoryDoc = mongoose.InferSchemaType<typeof SearchHistorySchema>;

export const SearchHistory =
  (mongoose.models.SearchHistory as mongoose.Model<SearchHistoryDoc>) ||
  mongoose.model<SearchHistoryDoc>("SearchHistory", SearchHistorySchema);

export type { SearchStatus, VerificationStatus };