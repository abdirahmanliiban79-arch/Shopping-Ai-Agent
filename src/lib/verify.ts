import type { ExtractionResult, VerificationStatus } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are a price extraction engine. Given a product query and raw text from an e-commerce product page, decide: 1) does this page sell the EXACT requested product (not accessory/bundle/case/refill/recommendation carousel)? 2) extract the product BASE price only — exclude shipping, tax, warranty, bundles, financing/monthly plans, membership prices, used/refurbished prices unless nothing else exists; 3) in_stock status — false if out of stock, sold out, pre-order, or discontinued; 4) if multiple conflicting prices with no clear context, or price requires add-to-cart to see, set verificationStatus UNVERIFIED_UNCERTAIN and price null. Respond ONLY with JSON matching this schema: {"product_title": string, "price": number|null, "currency": string (ISO 4217), "in_stock": boolean, "confidence_score": number 0-1, "verification_status": "VERIFIED"|"UNVERIFIED_UNCERTAIN", "reason": string (short)}.`;

const FAILURE_RESULT: ExtractionResult = {
  productTitle: "",
  price: null,
  currency: "USD",
  inStock: false,
  confidenceScore: 0,
  verificationStatus: "UNVERIFIED_UNCERTAIN",
  reason: "LLM parse failure",
};

const MODEL_CHAIN = [
  process.env.OPENROUTER_DEFAULT_MODEL,
  "google/gemini-2.5-flash",
  "anthropic/claude-3.5-haiku",
].filter((m): m is string => Boolean(m));

interface LlmJsonResponse {
  product_title?: string;
  price?: number | null;
  currency?: string;
  in_stock?: boolean;
  confidence_score?: number;
  verification_status?: string;
  reason?: string;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

async function callModel(
  model: string,
  query: string,
  pageText: string
): Promise<LlmJsonResponse> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://localhost:3000",
      "X-Title": "Shopping AI Agent",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Product query: ${query}\n\nPage text:\n${pageText.slice(0, 20000)}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (res.status === 429 || res.status === 404) {
    throw new Error(`Model ${model} unavailable (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status} for model ${model}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Empty response from model ${model}`);

  return JSON.parse(stripFences(content)) as LlmJsonResponse;
}

function mapToResult(raw: LlmJsonResponse): ExtractionResult {
  let status: VerificationStatus =
    raw.verification_status === "VERIFIED"
      ? "VERIFIED"
      : "UNVERIFIED_UNCERTAIN";

  const confidence =
    typeof raw.confidence_score === "number"
      ? Math.min(1, Math.max(0, raw.confidence_score))
      : 0;

  if (status === "VERIFIED" && confidence < 0.6) {
    status = "UNVERIFIED_UNCERTAIN";
  }

  let price: number | null = null;
  if (
    raw.verification_status === "VERIFIED" &&
    typeof raw.price === "number" &&
    raw.price > 0 &&
    Number.isFinite(raw.price)
  ) {
    price = raw.price;
  } else if (status === "VERIFIED") {
    status = "UNVERIFIED_UNCERTAIN";
  }

  return {
    productTitle: typeof raw.product_title === "string" ? raw.product_title : "",
    price,
    currency: typeof raw.currency === "string" ? raw.currency.toUpperCase() : "USD",
    inStock: raw.in_stock === true,
    confidenceScore: confidence,
    verificationStatus: status,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
  };
}

export async function verifyPage(opts: {
  query: string;
  pageText: string;
}): Promise<ExtractionResult> {
  const { query, pageText } = opts;
  if (!pageText || pageText.trim().length < 50) {
    return {
      ...FAILURE_RESULT,
      reason: "Page text empty or too short",
    };
  }

  let lastError: unknown = new Error("No models available");
  for (const model of MODEL_CHAIN) {
    try {
      const raw = await callModel(model, query, pageText);
      return mapToResult(raw);
    } catch (err) {
      lastError = err;
    }
  }
  void lastError;
  return FAILURE_RESULT;
}

export async function verifyPages(opts: {
  query: string;
  pages: { storeName: string; url: string; pageText: string }[];
  onResult?: (
    storeName: string,
    url: string,
    result: ExtractionResult
  ) => void;
}): Promise<{ storeName: string; url: string; result: ExtractionResult }[]> {
  const { query, pages, onResult } = opts;
  const results: { storeName: string; url: string; result: ExtractionResult }[] =
    [];
  const queue = [...pages];
  const CONCURRENCY = 3;

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const page = queue.shift();
      if (!page) break;

      let result: ExtractionResult;
      try {
        result = await verifyPage({ query, pageText: page.pageText });
      } catch {
        result = FAILURE_RESULT;
      }

      results.push({ storeName: page.storeName, url: page.url, result });
      try {
        onResult?.(page.storeName, page.url, result);
      } catch {
        // listener errors must not break the pool
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker())
  );

  return results;
}
