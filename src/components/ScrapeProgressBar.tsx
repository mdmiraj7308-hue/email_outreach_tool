"use client";

import { useEffect, useState } from "react";

/** Polls scrape progress and renders a determinate bar (leads found so far vs. the run's target). */
export function ScrapeProgressBar({ runId, maxLeads }: { runId: string; maxLeads: number }) {
  const [count, setCount] = useState(0);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/scrape/${runId}/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const total = (data.leadCount ?? 0) + (data.noWebsiteLeadCount ?? 0);
        if (cancelled) return;
        setCount(total);
        setPercent(maxLeads > 0 ? Math.min(99, Math.round((total / maxLeads) * 100)) : 0);
      } catch {
        // transient — next tick retries
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId, maxLeads]);

  return (
    <div className="mx-auto w-full max-w-sm space-y-2">
      <p className="text-sm text-[var(--ink-soft)]">
        Scraping in progress… {count} lead{count === 1 ? "" : "s"} found
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
        <div
          className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
