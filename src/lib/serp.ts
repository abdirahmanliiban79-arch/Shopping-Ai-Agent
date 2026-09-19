import type { DiscoveredUrl } from "./types";

const BLOCKED_DOMAINS = [
  "reddit.com",
  "quora.com",
  "wikipedia.org",
  "pinterest.com",
  "youtube.com",
  "facebook.com",
  "twitter.com",
  "instagram.com",
  "forbes.com",
  "medium.com",
  "stackexchange.com",
  "stackoverflow.com",
];

const KNOWN_RETAILERS = new Set([
  "walmart.com",
  "target.com",
  "bestbuy.com",
  "newegg.com",
  "ebay.com",
  "bhphotovideo.com",
  "homedepot.com",
  "costco.com",
  "apple.com",
  "amazon.com",
]);

const STORE_NAME_MAP: Record<string, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  target: "Target",
  bestbuy: "Best Buy",
  newegg: "Newegg",
  ebay: "eBay",
  costco: "Costco",
  apple: "Apple",
};

const NAME_JOIN_MAP: Record<string, string> = {
  bestbuy: "Best Buy",
  bhphotovideo: "B&H",
  homedepot: "Home Depot",
  newegg: "Newegg",
};

const PRODUCT_URL_PATTERN = /\/(product|products|dp|p|buy|item|ip)\//i;
const STORE_KEYWORD_PATTERN = /shop|store|mart/i;

interface SerpResult {
  link?: string;
  product_link?: string;
}

function getDomain(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isBlockedDomain(domain: string): boolean {
  return BLOCKED_DOMAINS.some((b) => domain === b || domain.endsWith(`.${b}`));
}

function looksLikeStoreDomain(domain: string): boolean {
  if (KNOWN_RETAILERS.has(domain)) return true;
  const base = domain.split(".")[0];
  return STORE_KEYWORD_PATTERN.test(base);
}

function prettifyName(domain: string): string {
  const parts = domain.split(".");
  const base = parts[0];
  if (NAME_JOIN_MAP[base]) return NAME_JOIN_MAP[base];
  if (STORE_NAME_MAP[base]) return STORE_NAME_MAP[base];
  return base
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isProductLike(url: string): boolean {
  return PRODUCT_URL_PATTERN.test(url);
}

export async function discoverUrls(query: string): Promise<DiscoveredUrl[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY is not set");

  const params = new URLSearchParams({
    engine: "google",
    q: query,
    location: "United States",
    hl: "en",
    gl: "us",
    num: "20",
    api_key: apiKey,
  });

  let res: Response;
  try {
    res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(
      `SerpAPI request failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    throw new Error(`SerpAPI returned HTTP ${res.status}`);
  }

  const data: unknown = await res.json();
  if (
    typeof data !== "object" ||
    data === null ||
    ("error" in data && typeof (data as { error: unknown }).error === "string")
  ) {
    throw new Error(
      `SerpAPI error: ${typeof data === "object" && data !== null && "error" in data ? (data as { error: string }).error : "unknown"}`
    );
  }

  const { organic_results: organic, shopping_results: shopping } =
    data as { organic_results?: SerpResult[]; shopping_results?: SerpResult[] };

  const candidates: { url: string; domain: string; shopping: boolean }[] = [];

  for (const item of shopping ?? []) {
    const url = item.product_link ?? item.link;
    if (!url) continue;
    const domain = getDomain(url);
    if (!domain || isBlockedDomain(domain)) continue;
    candidates.push({ url, domain, shopping: true });
  }

  for (const item of organic ?? []) {
    const url = item.link;
    if (!url) continue;
    const domain = getDomain(url);
    if (!domain || isBlockedDomain(domain)) continue;
    candidates.push({ url, domain, shopping: false });
  }

  const seen = new Map<string, DiscoveredUrl>();

  for (const c of candidates) {
    if (seen.size >= 10) break;
    if (seen.has(c.domain)) continue;

    if (!c.shopping && !isProductLike(c.url) && !looksLikeStoreDomain(c.domain)) {
      continue;
    }

    seen.set(c.domain, {
      url: c.url,
      storeDomain: c.domain,
      storeName: prettifyName(c.domain),
    });
  }

  if (seen.size < 3) {
    const fallback = await shoppingFallback(query, apiKey, seen);
    if (fallback.length > 0) return fallback;
  }

  return Array.from(seen.values());
}

async function shoppingFallback(
  query: string,
  apiKey: string,
  existing: Map<string, DiscoveredUrl>
): Promise<DiscoveredUrl[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    tbm: "shop",
    location: "United States",
    hl: "en",
    gl: "us",
    num: "20",
    api_key: apiKey,
  });

  let res: Response;
  try {
    res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return Array.from(existing.values());
  }

  if (!res.ok) return Array.from(existing.values());

  const data: unknown = await res.json().catch(() => null);
  const results = (data as { shopping_results?: SerpResult[] } | null)?.shopping_results ?? [];

  const fallback: DiscoveredUrl[] = Array.from(existing.values());
  const seen = new Map<string, boolean>();
  for (const u of fallback) seen.set(u.storeDomain, true);

  for (const item of results) {
    const url = item.product_link ?? item.link;
    if (!url) continue;
    const domain = getDomain(url);
    if (!domain || isBlockedDomain(domain)) continue;
    if (seen.has(domain) || fallback.length >= 10) break;
    seen.set(domain, true);
    fallback.push({
      url,
      storeDomain: domain,
      storeName: prettifyName(domain),
    });
  }

  return fallback;
}
