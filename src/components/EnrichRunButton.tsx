"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnSecondary } from "@/lib/ui";

interface Progress {
  campaignRunStatus: string | null;
  totalLeads: number;
  enrichRemaining: number;
  enrichDone: number;
  enrichFailed: number;
  qualifiedTotal: number;
  qualifiedDrafted: number;
}

async function fetchProgress(campaignRunId: string): Promise<Progress> {
  const res = await fetch(`/api/runs/${campaignRunId}/progress`);
  if (!res.ok) throw new Error("Failed to fetch progress");
  return res.json();
}

// Absolute progress against the run's fixed total — not "how much changed
// since this page loaded". A per-session baseline meant every refresh reset
// the reference point back to 0%, making a run that was genuinely most of
// the way done look like it had just started.
function percentFor(progress: Progress): number {
  if (progress.totalLeads === 0) return 100;
  const completed = progress.totalLeads - progress.enrichRemaining;
  return Math.min(100, Math.max(0, Math.round((completed / progress.totalLeads) * 100)));
}

export function EnrichRunButton({ campaignRunId }: { campaignRunId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [result, setResult] = useState<{ succeeded: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // If the page loads (or reloads) while a previous click's enrichment is
  // still being drained by the cron tick in the background, resume showing
  // progress instead of looking idle or reset.
  useEffect(() => {
    let cancelled = false;
    fetchProgress(campaignRunId)
      .then((progress) => {
        if (!cancelled && progress.campaignRunStatus === "enriching") {
          setPercent(percentFor(progress));
          void pollUntilDone();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignRunId]);

  /**
   * Polls progress until the run leaves "enriching". The actual enrichment
   * work happens in bounded batches driven by the cron tick (or the local
   * dev scheduler) in the background — this function only ever watches
   * progress; it never does the enrichment work itself.
   */
  function pollUntilDone(): Promise<void> {
    setRunning(true);
    return new Promise((resolve) => {
      pollRef.current = setInterval(async () => {
        try {
          const progress = await fetchProgress(campaignRunId);
          setPercent(percentFor(progress));
          if (progress.campaignRunStatus !== "enriching") {
            stopPolling();
            setPercent(100);
            setResult({ succeeded: progress.enrichDone, failed: progress.enrichFailed });
            setRunning(false);
            router.refresh();
            resolve();
          }
        } catch {
          // transient — next tick will retry
        }
      }, 1500);
    });
  }

  async function handleClick() {
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const initial = await fetchProgress(campaignRunId);
      setPercent(percentFor(initial));

      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignRunId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed");

      if (data.attempted === 0) {
        setPercent(100);
        setResult({ succeeded: initial.enrichDone, failed: initial.enrichFailed });
        setRunning(false);
        return;
      }

      await pollUntilDone();
    } catch (err) {
      stopPolling();
      setError(err instanceof Error ? err.message : "Enrichment failed");
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {result && !running && (
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            Enrichment complete — {result.succeeded} done
            {result.failed > 0 ? `, ${result.failed} failed` : ""}
          </span>
        )}
        <button onClick={handleClick} disabled={running} className={btnSecondary}>
          {running
            ? `Enriching… ${percent}%`
            : result
              ? "Re-run enrichment"
              : "Enrich All Pending"}
        </button>
      </div>
      {running && (
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
