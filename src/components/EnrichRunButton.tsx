"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnSecondary } from "@/lib/ui";

interface Progress {
  totalLeads: number;
  enrichNotDone: number;
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

  async function handleClick() {
    setRunning(true);
    setResult(null);
    setError(null);
    setPercent(0);

    try {
      const baseline = (await fetchProgress(campaignRunId)).enrichNotDone;

      if (baseline > 0) {
        pollRef.current = setInterval(async () => {
          try {
            const { enrichNotDone } = await fetchProgress(campaignRunId);
            const completedSoFar = Math.max(0, baseline - enrichNotDone);
            setPercent(Math.min(99, Math.round((completedSoFar / baseline) * 100)));
          } catch {
            // transient — next tick will retry
          }
        }, 1500);
      } else {
        setPercent(100);
      }

      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignRunId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed");

      stopPolling();
      setPercent(100);
      setResult({ succeeded: data.succeeded, failed: data.failed });
      router.refresh();
    } catch (err) {
      stopPolling();
      setError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {result && !running && (
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            Enrichment completed — {result.succeeded} done
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
