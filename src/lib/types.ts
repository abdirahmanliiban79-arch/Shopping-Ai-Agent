export type SearchStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export type VerificationStatus =
  | "VERIFIED"
  | "UNVERIFIED_BLOCKED"
  | "UNVERIFIED_UNCERTAIN"
  | "FAILED";

export interface ProgressEvent {
  searchId: string;
  step: string;
  progress: number;
  message: string;
  liveResult?: LiveResult | null;
}

export interface LiveResult {
  storeName: string;
  productUrl: string;
  price: number | null;
  currency: string | null;
  verificationStatus: VerificationStatus;
  productTitle?: string;
  inStock?: boolean;
  confidenceScore?: number | null;
  reason?: string;
}

export interface DiscoveredUrl {
  url: string;
  storeDomain: string;
  storeName: string;
}

export interface ScrapedPage {
  url: string;
  storeDomain: string;
  storeName: string;
  status: "OK" | "BLOCKED" | "FAILED";
  content: string | null;
  error?: string;
}

export interface ExtractionResult {
  productTitle: string;
  price: number | null;
  currency: string;
  inStock: boolean;
  confidenceScore: number;
  verificationStatus: VerificationStatus;
  reason?: string;
}