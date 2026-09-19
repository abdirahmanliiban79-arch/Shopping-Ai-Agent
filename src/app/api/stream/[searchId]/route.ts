import { getLog, subscribe } from "@/lib/eventBus";
import type { ProgressEvent } from "@/lib/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ searchId: string }> }
) {
  const { searchId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const send = (event: ProgressEvent) => {
        safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping\n\n`);
      }, 15000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const handleEvent = (event: ProgressEvent) => {
        send(event);
        if (event.step === "COMPLETED" || event.step === "FAILED") {
          cleanup();
        }
      };

      const unsubscribe = subscribe(searchId, handleEvent);

      req.signal.addEventListener("abort", cleanup);

      const log = getLog(searchId);
      const terminalIdx = log.findIndex(
        (e) => e.step === "COMPLETED" || e.step === "FAILED"
      );
      const replay = terminalIdx === -1 ? log : log.slice(0, terminalIdx + 1);
      for (const event of replay) {
        send(event);
      }
      if (terminalIdx !== -1) {
        cleanup();
      }
    },
    cancel() {
      // handled via req.signal abort listener; fallback no-op
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
