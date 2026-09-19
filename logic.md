# Logic & Business Flow Specification (LOGIC.md)

This document defines the core business logic, status state machine, edge-case mitigation strategy, dynamic verification algorithms, and live UI streaming behavior for the Autonomous Product Scraping & Price Verification system.

---

## 1. System Execution Pipeline & State Machine

Every search request initiated by the user traverses a strictly defined lifecycle managed via **Inngest**.

```
[ IDLE ] ──(User Submits Query)──> [ INITIALIZING ]
                                         │
                                         ▼
                                 [ DISCOVERING ] (SerpAPI)
                                         │
                                         ▼
                                  [ EXTRACTING ] (Playwright)
                                         │
                                         ▼
                                  [ VERIFYING ] (OpenRouter LLM)
                                         │
                                         ▼
                                 [ AGGREGATING ] (MongoDB Persistence)
                                         │
                                         ▼
                                   [ COMPLETED ]
```

### 1.1 State Definitions
* **`IDLE`**: Dashboard ready for user input.
* **`INITIALIZING`**: Entry created in MongoDB (`SearchHistory` with status `PENDING`). Inngest event triggered (`app/product.search`).
* **`DISCOVERING`**: SerpAPI queries Google for top organic/shopping product links (Target: Up to 10 store URLs).
* **`EXTRACTING`**: Playwright launches headless browser workers to visit each page, extract DOM content, and handle dynamic JS execution.
* **`VERIFYING`**: Raw text/DOM dumps are parsed by OpenRouter LLM to extract clean, standardized numerical prices and availability flags.
* **`AGGREGATING`**: Prices are normalized, validated, filtered, sorted, ranked, and saved to MongoDB (`ProductResult`).
* **`COMPLETED`**: Stream completes, sending final payload with top 3 ranked store recommendations (`🥇`, `🥈`, `🥉`) to the UI.
* **`FAILED`**: Terminal error occurred (e.g., all 10 links blocked/unreachable or SerpAPI failed completely).

---

## 2. Core Business Rules

### Rule 2.1: Discovery & URL Filtering
1. **Search Querying**: Submit the raw user prompt directly to SerpAPI (e.g., `Sony WH-1000XM5 buy price`).
2. **URL Selection Strategy**:
   * Filter out aggregator/forum domains (e.g., Reddit, Quora, Wikipedia, Pinterest, YouTube).
   * Restrict maximum scraped stores to **10 unique domain product links**.
   * Prioritize direct e-commerce landing pages (`/product/`, `/dp/`, `/p/`, `/buy/`).
3. **Google Shopping Fallback**: If the primary organic/shopping results yield fewer than 3 eligible store candidates (e.g., Google returned mostly social/forum content), automatically re-run the query with `tbm=shop` (Google Shopping vertical) to surface direct store product links.

### Rule 2.2: Page Extraction & Retry Logic
1. **Concurrency**: Scrape up to 10 discovered product pages using Playwright workers.
2. **Timeout**: 15-second page load timeout per URL.
3. **Retry Matrix**:
   * **Network Timeout / 5xx Error**: Retry once after a 2-second delay. If it fails a second time, record status as `FAILED`.
   * **CAPTCHA / Anti-Bot / Cloudflare Block**: Do **not** retry. Mark status immediately as `UNVERIFIED_BLOCKED`.
   * **404 / Page Not Found**: Skip immediately, mark status as `FAILED`.
4. **Early-Stop Optimization**: Scraping and AI verification are interleaved (each page is scraped then verified immediately). As soon as **2 VERIFIED in-stock prices** are found (🥇 Gold + 🥈 Silver), the scraper stops processing remaining pages to conserve resources and time. If the 2 verified stores happen to be the last pages in the queue, the remaining pages are all processed normally.

### Rule 2.3: AI Price Parsing & Extraction Logic
OpenRouter consumes the raw page content (or cleaned body text) and must apply strict rules:
1. **Product Match Verification**: Confirm that the page actually sells the exact requested product (not an accessory or related recommendation).
2. **Price Standardizing**:
   * Extract **Product Base Price Only**.
   * Exclude shipping fees, taxes, cross-sells, warranty add-ons, or monthly financing plans.
   * Strip currency symbols and return a clean decimal float value (e.g., `$299.99` $\rightarrow$ `299.99`).
3. **Stock Verification**: Ignore out-of-stock items or items marked "Pre-order" / "Sold Out".
4. **Uncertainty Handing**:
   * If multiple conflicting prices appear without clear context (e.g., refurbished vs. new), or if the price requires adding the item to a cart to view, set `verificationStatus` to `UNVERIFIED_UNCERTAIN` and set `price = null`.

---

## 3. Leaderboard Ranking & Filtering Algorithm

Once extraction and verification steps conclude for all candidate URLs:

```
                          [ Raw Scraped Results ]
                                     │
                                     ▼
                   Filter: verificationStatus == 'VERIFIED'
                                  and price > 0
                                  and in_stock == true
                                     │
                                     ▼
                      Sort By: price (Ascending)
                                     │
                                     ▼
                   Deduplicate By: storeDomain / Store Name
                                     │
                                     ▼
                       Take Top 3 (🥇 Rank 1, 🥈 Rank 2, 🥉 Rank 3)
```

1. **Inclusion Criteria**:
   * Only include results with `verificationStatus = 'VERIFIED'`.
   * Must have `in_stock = true`.
   * Price must be a valid positive float.
2. **Ranking**: Order matching entries by `price` ascending (cheapest to most expensive).
3. **Deduplication**: If the same store domain appears twice, retain only the lowest verified price entry for that store.
4. **Output Selection**: Select the top 3 lowest verified entries. Map them to ranks:
   * Rank 1 $\rightarrow$ 🥇 **Gold (Cheapest Verified)**
   * Rank 2 $\rightarrow$ 🥈 **Silver (Runner Up)**
   * Rank 3 $\rightarrow$ 🥉 **Bronze (Third Option)**

---

## 4. UI Streaming & Event Communication Logic

To ensure a seamless user experience, Next.js streams incremental updates back to the UI dashboard using Server-Sent Events (SSE) or Inngest webhooks.

### Progress Events Schema
Each step emits structured status updates:

```json
{
  "searchId": "65e0a12f93d4b1a8c9e41021",
  "step": "EXTRACTING",
  "progress": 40,
  "message": "Scraping 4 of 10 pages (Best Buy, Amazon, Target, Walmart)...",
  "liveResult": {
    "storeName": "Best Buy",
    "productUrl": "https://www.bestbuy.com/site/...",
    "price": 298.00,
    "currency": "USD",
    "verificationStatus": "VERIFIED"
  }
}
```

### Unverified/Blocked Output Representation
When a page is blocked or ambiguous, the dashboard displays it under an **"Unverified / Skipped Stores"** collapsible list in the UI:
* Display store name & product link.
* Display badge: `[ Blocked by Anti-Bot ]` or `[ Price Uncertain ]`.
* Exclude from podium calculations.

---

## 5. Architectural Recommendations for Next Steps

To make your system scalable, reliable, and cost-efficient, consider these enhancements during implementation:

1. **Proxy Rotation for Playwright**: Standard headless browsers will eventually hit anti-bot walls (Cloudflare/Akamai). Integrate a proxy provider (e.g., Bright Data, ScraperAPI, or Webshare) with Playwright for reliable scraping.
2. **Context Compression before LLM**: Sending raw 500KB DOM strings to OpenRouter consumes unnecessary tokens. Strip SVG tags, base64 images, header/footer navigation, and inline CSS scripts *before* feeding HTML to OpenRouter.
3. **Database Caching Strategy**: Implement a 24-hour cache in MongoDB for identical search queries. If a query was completed less than 24 hours ago, serve stored results instantly instead of re-executing SerpAPI and Playwright tasks.