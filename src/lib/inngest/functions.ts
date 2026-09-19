import { inngest, PRODUCT_SEARCH_EVENT } from "./client";
import type { ProductSearchEvent } from "./client";
import { connectDB } from "../db";
import { SearchHistory, ProductResult } from "../models";
import { discoverUrls } from "../serp";
import { scrapePages } from "../scraper";
import { verifyPages } from "../verify";
import { rankResults } from "../rank";
import { emitProgress, initLog, getLog } from "../eventBus";
import type { ProgressEvent, LiveResult, ScrapedPage, DiscoveredUrl } from "../types";

function liveFrom(
  storeName: string,
  productUrl: string,
  price: number | null,
  currency: string | null,
  verificationStatus: LiveResult["verificationStatus"],
  extra?: Partial<LiveResult>
): LiveResult {
  return {
    storeName,
    productUrl,
    price,
    currency,
    verificationStatus,
    ...extra,
  };
}

function progress(
  searchId: string,
  step: string,
  pct: number,
  message: string,
  liveResult?: LiveResult
): ProgressEvent {
  const evt: ProgressEvent = { searchId, step, progress: pct, message, liveResult: liveResult ?? null };
  emitProgress(evt);
  return evt;
}

export const productSearchFn = inngest.createFunction(
  { id: "product-search-pipeline", retries: 1 },
  { event: PRODUCT_SEARCH_EVENT },
  async ({ event, step }: { event: ProductSearchEvent; step: any }) => {
    const { query, searchId } = event.data;
    const searchIdObj = new (await import("mongoose")).default.Types.ObjectId(searchId);
    if (getLog(searchId).length === 0) {
      initLog(searchId);
      progress(searchId, "INITIALIZING", 5, `Initializing search for "${query}"...`);
    }

    try {
      await step.run("init-status", async () => {
        await connectDB();
        await SearchHistory.findByIdAndUpdate(searchId, { status: "PROCESSING" });
        progress(searchId, "DISCOVERING", 10, `Searching the web for "${query}"...`);
      });

      const urls: DiscoveredUrl[] = await step.run("discover-urls", async () => {
        const urls = await discoverUrls(query);
        progress(
          searchId,
          "DISCOVERING",
          20,
          `Found ${urls.length} store candidates` +
            (urls.length ? `: ${urls.map((u) => u.storeName).join(", ")}` : "")
        );
        if (urls.length === 0) throw new Error("No store URLs discovered — SerpAPI returned nothing usable");
        return urls;
      });

      const scraped: ScrapedPage[] = await step.run("scrape-pages", async () => {
        let done = 0;
        const pages = await scrapePages(urls, (d, total, storeName) => {
          if (d > done) {
            done = d;
            progress(
              searchId,
              "EXTRACTING",
              Math.min(20 + Math.round((d / total) * 30), 50),
              `Scraping ${d} of ${total} pages (latest: ${storeName})...`
            );
          }
        });
        const blocked = pages.filter((p) => p.status === "BLOCKED").length;
        const failed = pages.filter((p) => p.status === "FAILED").length;
        const ok = pages.filter((p) => p.status === "OK").length;
        progress(
          searchId,
          "EXTRACTING",
          50,
          `Extraction done: ${ok} scraped, ${blocked} blocked, ${failed} failed`
        );
        if (ok === 0) {
          throw new Error("All store pages were blocked or unreachable — cannot verify any prices");
        }
        return pages;
      });

      const verified = await step.run("verify-prices", async () => {
        const verifiable: ScrapedPage[] = scraped.filter(
          (p: ScrapedPage) => p.status === "OK" && p.content && p.content.length > 50
        );
        const seen = new Set<string>();
        for (const p of scraped) {
          if (p.status !== "OK") {
            if (seen.has(p.storeDomain)) continue;
            seen.add(p.storeDomain);
            progress(
              searchId,
              "VERIFYING",
              55,
              `${p.storeName}: ${p.status === "BLOCKED" ? "blocked by anti-bot" : "extraction failed"}`,
              liveFrom(p.storeName, p.url, null, null, p.status === "BLOCKED" ? "UNVERIFIED_BLOCKED" : "FAILED", {
                reason: p.error,
              })
            );
          }
        }
        const verified: { storeName: string; url: string; result: any }[] = await verifyPages({
          query,
          pages: verifiable.map((p) => ({ storeName: p.storeName, url: p.url, pageText: p.content! })),
          onResult: (storeName, url, result) => {
            progress(
              searchId,
              "VERIFYING",
              Math.min(50 + Math.round(((seen.size + 1) / (verifiable.length + 1)) * 25), 75),
              `${storeName}: ${result.verificationStatus === "VERIFIED" ? `verified at ${result.price} ${result.currency}` : result.reason || "uncertain"}`,
              liveFrom(storeName, url, result.price, result.price !== null ? result.currency : null, result.verificationStatus, {
                productTitle: result.productTitle,
                inStock: result.inStock,
                confidenceScore: result.confidenceScore,
                reason: result.reason,
              })
            );
          },
        });
        return verified;
      });

      const final = await step.run("save-and-rank", async () => {
        await connectDB();
        const scrapedMap = new Map(scraped.map((p) => [p.url, p] as const));

        const docs: any[] = [];
        for (const v of verified) {
          const sp = scrapedMap.get(v.url);
          docs.push({
            searchId: searchIdObj,
            storeName: v.storeName,
            storeDomain: sp?.storeDomain ?? new URL(v.url).hostname,
            productUrl: v.url,
            productTitle: v.result.productTitle || null,
            price: v.result.price,
            currency: v.result.currency || "USD",
            inStock: v.result.inStock,
            confidenceScore: v.result.confidenceScore,
            verificationStatus: v.result.verificationStatus,
            reason: v.result.reason || null,
          });
        }
        for (const p of scraped) {
          if (
            p.status !== "OK" &&
            !docs.some((d) => d.productUrl === p.url)
          ) {
            docs.push({
              searchId: searchIdObj,
              storeName: p.storeName,
              storeDomain: p.storeDomain,
              productUrl: p.url,
              price: null,
              currency: "USD",
              inStock: null,
              verificationStatus: p.status === "BLOCKED" ? "UNVERIFIED_BLOCKED" : "FAILED",
              reason: p.error || (p.status === "BLOCKED" ? "blocked by anti-bot" : "extraction failed"),
            });
          }
        }

        const saved = docs.length
          ? await ProductResult.insertMany(docs)
          : [];

        const rankedInput = saved.map((d: any) => d.toObject?.() ?? d);
        const top3 = rankResults(rankedInput);
        for (const r of top3 as any[]) {
          await ProductResult.updateOne(
            { _id: r._id },
            { $set: { rank: r.rank } }
          );
        }

        const status = top3.length > 0 ? "COMPLETED" : "FAILED";
        await SearchHistory.findByIdAndUpdate(searchId, {
          status,
          completedAt: new Date(),
          results: saved.map((d: any) => d._id),
          errorMessage: top3.length === 0 ? "No verified in-stock prices found" : null,
        });

        if (top3.length === 0) {
          progress(searchId, "AGGREGATING", 90, "No verified in-stock prices found — marking as FAILED");
        } else {
          progress(
            searchId,
            "AGGREGATING",
            90,
            `Saved ${saved.length} results, ranked top ${top3.length} cheapest stores`
          );
        }

        return { topCount: top3.length, savedCount: saved.length };
      });

      const lastEvent = getLog(searchId);
      const lastResult = [...lastEvent].reverse().find((e) => e.liveResult?.verificationStatus === "VERIFIED");

      if (final.topCount > 0) {
        progress(
          searchId,
          "COMPLETED",
          100,
          `Search complete — top ${final.topCount} cheapest verified stores found`,
          lastResult?.liveResult ?? undefined
        );
      } else {
        progress(searchId, "FAILED", 100, "Search failed — no verified in-stock prices could be extracted from any store");
      }
      return { searchId, status: final.topCount > 0 ? "COMPLETED" : "FAILED", ...final };
    } catch (err: any) {
      await connectDB().catch(() => {});
      await SearchHistory.findByIdAndUpdate(searchId, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: String(err?.message ?? err).slice(0, 500),
      }).catch(() => {});
      progress(searchId, "FAILED", 100, `Search failed: ${String(err?.message ?? err).slice(0, 200)}`);
      return { searchId, status: "FAILED" };
    }
  }
);

export const functions = [productSearchFn];