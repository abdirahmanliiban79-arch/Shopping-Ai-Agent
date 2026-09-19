import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { SearchHistory, ProductResult } from "@/lib/models";
import { inngest } from "@/lib/inngest/client";
import { emitProgress, initLog } from "@/lib/eventBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query ?? "").trim();
    if (!query || query.length < 2) {
      return NextResponse.json({ error: "A product query is required" }, { status: 400 });
    }

    await connectDB();

    const cached = await SearchHistory.findOne({
      query,
      status: "COMPLETED",
      completedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }).sort({ completedAt: -1 });

    if (cached) {
      initLog(cached._id.toString());
      const results = await ProductResult.find({ searchId: cached._id }).lean();
      for (const r of results) {
        emitProgress({
          searchId: cached._id.toString(),
          step: "COMPLETED",
          progress: 100,
          message: "Served from 24h cache — identical recent search",
          liveResult: {
            storeName: r.storeName,
            productUrl: r.productUrl,
            price: r.price ?? null,
            currency: r.currency,
            verificationStatus: r.verificationStatus,
            productTitle: r.productTitle ?? undefined,
            inStock: r.inStock ?? undefined,
            confidenceScore: r.confidenceScore ?? undefined,
          },
        });
      }
      return NextResponse.json({ searchId: cached._id.toString(), cached: true });
    }

    const search = await SearchHistory.create({ query, status: "PENDING" });
    const searchId = search._id.toString();

    initLog(searchId);
    emitProgress({
      searchId,
      step: "INITIALIZING",
      progress: 5,
      message: `Initializing search for "${query}"...`,
    });

    await inngest.send({
      name: "app/product.search",
      data: { query, searchId },
    });

    return NextResponse.json({ searchId, cached: false }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? "Failed to start search") },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const searchId = new URL(req.url).searchParams.get("searchId");
  if (!searchId) {
    return NextResponse.json({ error: "searchId is required" }, { status: 400 });
  }
  await connectDB();
  const search = await SearchHistory.findById(searchId).lean();
  if (!search) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const results = await ProductResult.find({ searchId }).lean();
  return NextResponse.json({ search, results });
}