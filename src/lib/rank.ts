import type { VerificationStatus } from "./types";

export interface RankedResult {
  storeName: string;
  storeDomain: string;
  productUrl: string;
  productTitle: string;
  price: number;
  currency: string;
  rank: 1 | 2 | 3;
}

export function rankResults<
  T extends {
    verificationStatus: VerificationStatus;
    price: number | null;
    inStock: boolean | null;
    storeDomain?: string;
    storeName: string;
  }
>(results: T[]): T[] {
  const eligible = results.filter(
    (r) =>
      r.verificationStatus === "VERIFIED" &&
      r.price !== null &&
      r.price > 0 &&
      r.inStock === true
  );

  eligible.sort((a, b) => (a.price as number) - (b.price as number));

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const r of eligible) {
    const key = r.storeDomain ?? r.storeName;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return deduped.slice(0, 3).map((r, i) => ({ ...r, rank: (i + 1) as 1 | 2 | 3 }));
}
