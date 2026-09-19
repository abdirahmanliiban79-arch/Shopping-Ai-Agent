# Shopping AI Agent

AI-powered autonomous product scraping & price verification system. Search for any product and get a live-streamed top-3 leaderboard of the cheapest verified in-stock prices across stores.

## How it works

```
User Query → SerpAPI Discovery → Playwright Extraction → OpenRouter Price Verification → MongoDB Ranking → Top 3 Podium (🥇🥈🥉)
```

Every search runs as an **Inngest** workflow with 4 steps:
1. **init-status** — creates the MongoDB entry, marks search `PROCESSING`
2. **discover-urls** — SerpAPI finds up to 10 store product links (with Google Shopping fallback)
3. **scrape-and-verify** — each page is scraped with headless Playwright, then verified by an LLM (base price only, in-stock check); stops early after 2 verified stores
4. **save-and-rank** — filters to `VERIFIED` + in-stock, sorts by price ascending, dedupes by store domain, persists to MongoDB, streams the terminal result

The dashboard receives incremental progress via **Server-Sent Events (SSE)**.

## Tech stack

- **Next.js 15** (App Router) — dashboard, API routes, SSE streaming
- **Inngest** — durable workflow orchestration
- **SerpAPI** — Google search / shopping discovery
- **Playwright** — headless browser extraction
- **OpenRouter** — LLM price verification (JSON mode, model fallback chain)
- **MongoDB Atlas** — `SearchHistory` + `ProductResult` schemas

## Setup

1. Clone and install:

   ```bash
   npm install
   npx playwright install chromium
   ```

2. Copy `.env.example` to `.env` and fill in your keys:

   ```bash
   cp .env.example .env
   ```

3. Run the Inngest dev server (terminal 1):

   ```bash
   npx inngest-cli@latest dev
   ```

4. Run the Next.js dev server (terminal 2):

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000 and search for any product.

## Development

- `npm run dev` — start Next.js dev server
- `npm run build` — production build
- `npx tsc --noEmit -p tsconfig.json` — typecheck