import { chromium, type Browser, type BrowserContext } from "playwright";
import type { DiscoveredUrl, ScrapedPage } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const CAPTCHA_MARKERS = [
  "captcha",
  "are you a robot",
  "access denied",
  "unusual traffic",
  "verify you are human",
];

async function createPage(browser: Browser) {
  const context: BrowserContext = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  return { context, page };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function isBlockedText(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("just a moment")) return true;
  return CAPTCHA_MARKERS.some((m) => lower.includes(m));
}

function truncate(text: string): string {
  if (text.length <= 12000) return text;
  return `${text.slice(0, 9000)}\n...\n${text.slice(-3000)}`;
}

function isCaptchaStatus(status: number | null): boolean {
  return status === 403 || status === 429;
}

function isServerError(status: number | null): boolean {
  return status !== null && status >= 500;
}

async function scrapeSingle(
  browser: Browser,
  target: DiscoveredUrl
): Promise<ScrapedPage> {
  const { context, page } = await createPage(browser);

  try {
    let response: Awaited<ReturnType<typeof page.goto>> | undefined;
    try {
      response = await page.goto(target.url, {
        timeout: 15000,
        waitUntil: "domcontentloaded",
      });
    } catch {
      response = undefined;
    }

    const status: number | null =
      response && typeof response.status === "function" ? response.status() : null;

    if (status === 404) {
      return { ...target, status: "FAILED", content: null, error: "HTTP 404 Not Found" };
    }

    await sleep(1500);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 300);
      });
      await sleep(400);
    }

    const text = await page.evaluate(() => document.body?.innerText || "");

    if (isBlockedText(text) || page.url().toLowerCase().includes("captcha")) {
      return {
        ...target,
        status: "BLOCKED",
        content: null,
        error: "CAPTCHA or anti-bot challenge detected",
      };
    }

    if (isCaptchaStatus(status)) {
      return {
        ...target,
        status: "BLOCKED",
        content: null,
        error: `Blocked by server (HTTP ${status})`,
      };
    }

    if (!response && text.trim() === "") {
      return {
        ...target,
        status: "FAILED",
        content: null,
        error: "Navigation failed (timeout or network error)",
      };
    }

    if (isServerError(status) || (!response && text.trim() !== "" && status === null)) {
      return {
        ...target,
        status: "FAILED",
        content: null,
        error: `Server error (HTTP ${status ?? "unknown"})`,
      };
    }

    return { ...target, status: "OK", content: truncate(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...target, status: "FAILED", content: null, error: message };
  } finally {
    await context.close();
  }
}

async function scrapeSingleWithRetry(
  browser: Browser,
  target: DiscoveredUrl
): Promise<ScrapedPage> {
  const first = await scrapeSingle(browser, target);

  if (first.status === "OK") return first;

  if (first.status === "BLOCKED") return first;

  if (first.error?.includes("404")) return first;

  await sleep(2000);
  const second = await scrapeSingle(browser, target);
  return second;
}

export interface ScraperHandle {
  scrape: (target: DiscoveredUrl) => Promise<ScrapedPage>;
  close: () => Promise<void>;
}

export async function createScraper(): Promise<ScraperHandle> {
  const browser: Browser = await chromium.launch({ headless: true });
  return {
    scrape: (target: DiscoveredUrl) => scrapeSingleWithRetry(browser, target),
    close: async () => {
      await browser.close().catch(() => {});
    },
  };
}

export interface ScrapeOptions {
  onProgress?: (done: number, total: number, storeName: string) => void;
  shouldStop?: () => boolean;
}

export async function scrapePages(
  urls: DiscoveredUrl[],
  opts?: ScrapeOptions | ((done: number, total: number, storeName: string) => void)
): Promise<ScrapedPage[]> {
  const options: ScrapeOptions =
    typeof opts === "function" ? { onProgress: opts } : opts ?? {};
  const { onProgress, shouldStop } = options;

  const total = urls.length;
  const results = new Array<ScrapedPage | null>(total).fill(null);
  let done = 0;

  const scraper = await createScraper();

  try {
    let nextIndex = 0;
    const CONCURRENCY = 3;

    const worker = async () => {
      while (nextIndex < total) {
        if (shouldStop?.()) return;
        const index = nextIndex++;
        const result = await scraper.scrape(urls[index]);
        results[index] = result;
        done++;
        onProgress?.(done, total, result.storeName);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker())
    );

    return results.map(
      (r, i) =>
        r ?? {
          ...urls[i],
          status: "FAILED" as const,
          content: null,
          error: shouldStop?.() ? "Skipped (target verified results reached)" : "Scraping did not complete",
        }
    );
  } finally {
    await scraper.close();
  }
}