# Technical Specification (TECH.md)

This document details the tech stack, component architectures, environment configurations, and setup workflows for the AI-powered Autonomous Product Scraping & Price Verification Pipeline.

## 1. Tech Stack & Component Roles

| Technology | Category | Role / Responsibility | 
 | ----- | ----- | ----- | 
| **Next.js (App Router)** | Framework & UI | Frontend dashboard, API routes, and Server-Sent Events (SSE) / streaming UI for live updates. | 
| **OpenRouter API** | AI / LLM Gateway | Flexible interface for selecting and executing LLM tasks (query formulation, page parsing, structured data extraction). | 
| **SerpAPI** | Web Search | Autonomous Google Search discovery to retrieve relevant product store URLs based on user query. | 
| **Playwright** | Web Automation | Headless web scraper that opens product pages, renders dynamic JS, handles basic bot mitigation, and dumps DOM/text content. | 
| **Inngest** | Workflow Orchestration | Durable, serverless queue/step-function executor. Controls retries, rate limits, timeouts, and state management across steps. | 
| **MongoDB atlas** | Database | Stores search query histories, scraped store records, verified price logs, and status flags. | 
| **Vercel** | Hosting & Deployment | Serverless deployment platform hosting the Next.js app, frontend streaming, and API routes. | 

## 2. System Architecture Flow

```
+-------------------------------------------------------------------------------+
|                               NEXT.JS DASHBOARD                               |
|                     (User Input -> SSE / Streaming UI)                        |
+-------------------------------------------------------------------------------+
                                       |
                                       v
+-------------------------------------------------------------------------------+
|                                INNGEST ENGINE                                 |
|            (Durable Execution / Workflow Queues / Retry Logic)                |
+-------------------------------------------------------------------------------+
     |                                 |                                  |
     v                                 v                                  v
+------------------+         +-------------------+             +------------------+
|    OPENROUTER    |         |      SERPAPI      |             |    PLAYWRIGHT    |
| (Strategy / Data |         | (Product Search & |             | (DOM Extraction  |
|   Extraction)    |         |   Link Discovery) |             |  & Browser Exec) |
+------------------+         +-------------------+             +------------------+
     |                                 |                                  |
     +---------------------------------+----------------------------------+
                                       |
                                       v
+-------------------------------------------------------------------------------+
|                              MONGODB DATABASE                                 |
|                 (Search History & Verified Results Logs)                      |
+-------------------------------------------------------------------------------+

```

## 3. Component Details & Design Specifications

### 3.1 Next.js Dashboard

* **Router**: Next.js App Router (`/app`).

* **State & Live Updates**: Implement an SSE (Server-Sent Events) endpoint or Inngest real-time webhook listener to stream progress logs and live scraped products directly to the UI.

* **Layout**: Single-page dashboard containing:

  * Search bar (Input single product query).

  * Real-time progress bar and log feed (Current page being scraped, status).

  * Ranked top-3 podium leaderboard (🥇 🥈 🥉) showing verified prices, store names, and product URLs.

### 3.2 Inngest Workflow Orchestrator

* **Trigger**: `app/product.search` event payload containing `query` and `searchId`.

* **Step Strategy**:

  1. `step.run('discover-urls')`: Query SerpAPI for the product, returning top candidate URLs (up to 10 max).

  2. `step.run('scrape-pages')`: Parallel or sequential invocation of Playwright scraper for up to 10 URLs.

  3. `step.run('verify-prices')`: Send raw extracted page context to OpenRouter for structured price extraction.

  4. `step.run('save-and-rank')`: Save results to MongoDB, compute top 3 verified cheapest options, and push state to client.

### 3.3 Playwright Web Scraper

* **Browser Instance**: Headless Chromium (`playwright-core` / `@sparticuz/chromium` for Vercel serverless compatibility if deployed on serverless, or dedicated browser service).

* **Page Limit**: Maximum **10 pages** per workflow.

* **Retry Policy**: 1 retry attempt per failed page before skipping.

* **Extraction Output**: Cleaned inner text, body content, or minimal HTML tree.

* **Error Handling**:

  * Blocked / Anti-Bot / CAPTCHA $\rightarrow$ Return status `BLOCKED_UNVERIFIED`.

  * Timeout / 4xx / 5xx $\rightarrow$ Retry once, then mark `FAILED`.

### 3.4 OpenRouter Integration

* **Model Selection**: Flexible dynamic fallback (e.g., `google/gemini-2.5-flash` or `anthropic/claude-3.5-haiku` for cost efficiency and high schema precision).

* **Extraction Task**: Enforce JSON output mode.

  * Extract strictly: `product_title`, `price` (numerical value), `currency`, `in_stock` (boolean), `confidence_score`.

  * Exclude shipping costs, bundle additions, or subscription rates. Keep `price` as product price only.

### 3.5 MongoDB Data Schema

* **Search Schema (`SearchHistory`)**:

  * `_id`: ObjectId

  * `query`: String

  * `createdAt`: Timestamp

  * `status`: Enum (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`)

  * `results`: Array of Result ObjectIDs

* **Result Schema (`ProductResult`)**:

  * `searchId`: Ref -> SearchHistory

  * `storeName`: String

  * `productUrl`: String

  * `price`: Number (nullable if unverified)

  * `currency`: String

  * `verificationStatus`: Enum (`VERIFIED`, `UNVERIFIED_BLOCKED`, `UNVERIFIED_UNCERTAIN`, `FAILED`)

  * `rank`: Number (1, 2, 3 or null)



```

```

## 5. Setup & Development Instructions

### Step 1: Clone & Install Dependencies

```
npm install next react react-dom inngest openrouter serpapi playwright mongodb mongoose
npm install -D typescript @types/node

```

### Step 2: Initialize Playwright Binaries

```
npx playwright install chromium

```

### Step 3: Run Local Inngest Dev Server

```
npx inngest-cli@latest dev

```

### Step 4: Run Next.js Development Server

```
npm run dev

```