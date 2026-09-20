"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveResult, ProgressEvent } from "@/lib/types";

interface RankEntry extends LiveResult {
  price: number;
}

interface LogLine {
  time: string;
  message: string;
}

const terminal = (step: string) => step === "COMPLETED" || step === "FAILED";

function formatPrice(price: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
    }).format(price);
  } catch {
    return `$${price.toFixed(2)}`;
  }
}

function badgeFor(status: LiveResult["verificationStatus"]): {
  className: string;
  label: string;
} | null {
  switch (status) {
    case "VERIFIED":
      return { className: "badge badge-verified", label: "Verified" };
    case "UNVERIFIED_BLOCKED":
      return {
        className: "badge badge-blocked",
        label: "[ Blocked by Anti-Bot ]",
      };
    case "UNVERIFIED_UNCERTAIN":
      return { className: "badge badge-uncertain", label: "[ Price Uncertain ]" };
    case "FAILED":
      return { className: "badge badge-failed", label: "[ Failed ]" };
  }
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [verified, setVerified] = useState<RankEntry[]>([]);
  const [skipped, setSkipped] = useState<LiveResult[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const logFeedRef = useRef<HTMLDivElement | null>(null);
  const stepRef = useRef<string | null>(null);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const handleEvent = useCallback((event: ProgressEvent) => {
    setStep(event.step);
    stepRef.current = event.step;  // update ref synchronously so onerror sees the correct value
    setProgress((prev) => Math.max(prev, event.progress));
    setStatusMessage(event.message);
    setLogLines((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString(), message: event.message },
    ]);
    if (event.step === "FAILED") {
      setError(event.message);
    }
    if (event.liveResult) {
      const lr = event.liveResult;
      if (
        lr.verificationStatus === "VERIFIED" &&
        lr.price !== null &&
        lr.price > 0
      ) {
        setVerified((prev) => {
          if (prev.some((v) => v.productUrl === lr.productUrl)) return prev;
          return [...prev, { ...lr, price: lr.price! }];
        });
      } else if (lr.verificationStatus !== "VERIFIED") {
        setSkipped((prev) => {
          if (prev.some((s) => s.productUrl === lr.productUrl)) return prev;
          return [...prev, lr];
        });
      }
    }
  }, []);

  useEffect(() => {
    return () => closeStream();
  }, [closeStream]);

  useEffect(() => {
    if (logFeedRef.current) {
      logFeedRef.current.scrollTop = logFeedRef.current.scrollHeight;
    }
  }, [logLines]);

  useEffect(() => {
    if (terminal(step ?? "")) {
      closeStream();
      setIsSearching(false);
    }
    // stepRef is now kept current inside handleEvent; no need to sync it here
  }, [step, closeStream]);

  useEffect(() => {
    if (!isSearching) return;
    const t = setTimeout(() => {
      closeStream();
      setIsSearching(false);
      setStep("FAILED");
      setError("Search timed out after 5 minutes. Please try again.");
    }, 300000);
    return () => clearTimeout(t);
  }, [isSearching, closeStream]);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;

    closeStream();
    setIsSearching(true);
    setProgress(0);
    setStatusMessage("");
    setLogLines([]);
    setVerified([]);
    setSkipped([]);
    setStep(null);
    setError(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      if (!res.ok) {
        throw new Error(`Search request failed (${res.status})`);
      }
      const data: { searchId: string } = await res.json();

      const es = new EventSource(`/api/stream/${data.searchId}`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const event: ProgressEvent = JSON.parse(e.data);
          handleEvent(event);
        } catch {
          // skip malformed frame; stream continues
        }
      };
      es.onerror = () => {
        if (terminal(stepRef.current ?? "")) return;
        // readyState CONNECTING = auto-reconnect in progress; the server
        // replays missed events on reconnect, so just wait it out.
        // Only give up when the browser has fully closed the connection.
        if (es.readyState === EventSource.CLOSED) {
          setStep("FAILED");
          setError("Lost connection to the search stream.");
          setIsSearching(false);
          closeStream();
        }
      };
    } catch (err) {
      setStep("FAILED");
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
      setIsSearching(false);
    }
  }, [query, isSearching, closeStream, handleEvent]);

  const podium = [...verified]
    .sort((a, b) => a.price - b.price)
    .slice(0, 3)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));

  const medals = ["🥇 1st Place", "🥈 2nd Place", "🥉 3rd Place"];

  const hasTerminalStep = step === "COMPLETED" || step === "FAILED";
  const showPodium = podium.length > 0;

  return (
    <div className="container">
      <h1>Shopping AI Agent</h1>
      <p className="subtitle">AI-powered price comparison across stores</p>

      <div className="card">
        <div className="search-bar">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSearch();
            }}
            placeholder="tusaale Iphone jibis pro fakis 😁"
            disabled={isSearching}
          />
          <button onClick={() => void handleSearch()} disabled={isSearching}>
            {isSearching ? (
              <>
                <span className="loading" /> Searching…
              </>
            ) : (
              "Search"
            )}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {step === "COMPLETED" && !error && (
        <div className="complete-line">
          Search complete — top {podium.length} verified store
          {podium.length === 1 ? "" : "s"} ranked by lowest price.
        </div>
      )}

      {(isSearching || logLines.length > 0) && (
        <div className="card">
          <p className="status-text">
            {statusMessage || "Waiting for first update…"}
          </p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="log-feed" ref={logFeedRef}>
            {logLines.map((line, i) => (
              <div className="log-line" key={i}>
                <span className="log-time">{line.time}</span>
                {line.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {showPodium && (
        <div className="card">
          <h2 className="section-title">🏆 Top 3 Stores</h2>
          <div className="podium">
            {podium.map((entry) => (
              <div className={`store-card rank-${entry.rank}`} key={`${entry.storeName}-${entry.rank}`}>
                <div className="rank-label">{medals[entry.rank - 1]}</div>
                <div className="store-name">{entry.storeName}</div>
                {entry.productTitle && (
                  <div className="product-title">{entry.productTitle}</div>
                )}
                <div className="price">
                  {formatPrice(entry.price, entry.currency)}
                </div>
                <a
                  className="visit-link"
                  href={entry.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit Store →
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {skipped.length > 0 && (
        <details className="unverified-list">
          <summary>
            Unverified / Skipped Stores ({skipped.length})
          </summary>
          {skipped.map((entry, i) => {
            const badge = badgeFor(entry.verificationStatus);
            return (
              <div className="unverified-item" key={i}>
                <a href={entry.productUrl} target="_blank" rel="noopener noreferrer">
                  {entry.storeName}
                </a>
                {badge && <span className={badge.className}>{badge.label}</span>}
              </div>
            );
          })}
        </details>
      )}

      {!isSearching && logLines.length === 0 && podium.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🛒</div>
          <p>Search for any product to compare prices across stores</p>
        </div>
      )}

      {hasTerminalStep && podium.length === 0 && skipped.length === 0 && step === "COMPLETED" && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <p>No verified results found. Try a different query.</p>
        </div>
      )}
    </div>
  );
}
