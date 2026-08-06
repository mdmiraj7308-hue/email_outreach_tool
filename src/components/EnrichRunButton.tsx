"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnSecondary } from "@/lib/ui";

interface Progress {
  campaignRunStatus: string | null;
  totalLeads: number;
  enrichNotDone: number;
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
  // progress instead of looking idle.
  useEffect(() => {
    let cancelled = false;
    fetchProgress(campaignRunId)
      .then((progress) => {
        if (!cancelled && progress.campaignRunStatus === "enriching") {
          void pollUntilDone(progress.enrichNotDone);
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
   * dev scheduler) in the background — a single request enriching every
   * pending lead synchronously used to reliably exceed Vercel's function
   * time limit on any run with more than a handful of leads left,
   * surfacing as a non-JSON timeout page the client couldn't parse
   * ("Unexpected token 'A'..."). This function only ever watches progress;
   * it never does the enrichment work itself.
   */
  function pollUntilDone(baseline: number): Promise<void> {
    setRunning(true);
    setPercent(baseline > 0 ? 0 : 100);
    return new Promise((resolve) => {
      pollRef.current = setInterval(async () => {
        try {
          const progress = await fetchProgress(campaignRunId);
          if (baseline > 0) {
            const completedSoFar = Math.max(0, baseline - progress.enrichNotDone);
            setPercent(Math.min(99, Math.round((completedSoFar / baseline) * 100)));
          }
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
    setPercent(0);

    try {
      const baseline = (await fetchProgress(campaignRunId)).enrichNotDone;

      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignRunId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed");

      if (data.attempted === 0) {
        setPercent(100);
        setResult({ succeeded: 0, failed: 0 });
        setRunning(false);
        return;
      }

      await pollUntilDone(baseline);
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
