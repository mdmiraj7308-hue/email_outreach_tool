"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary } from "@/lib/ui";

/**
 * Pushes current lead/draft state for this run's qualified leads to the
 * Google Sheet. Drafting is handled elsewhere now — automatically on
 * qualification, and per-campaign via "Write emails + 2 follow-ups" on a
 * Sending Campaign — this button only re-syncs the sheet.
 */
export function UpdateSheetButton({ campaignRunId }: { campaignRunId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ updated: number; failed: number; firstError?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${campaignRunId}/update-sheet`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update sheet");
      setResult({ updated: data.updated, failed: data.failed, firstError: data.firstError });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update sheet");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {result && !running && (
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            Synced {result.updated} lead{result.updated === 1 ? "" : "s"} to the sheet
            {result.failed > 0 ? `, ${result.failed} failed` : ""}
          </span>
        )}
        <button onClick={handleRun} disabled={running} className={btnPrimary}>
          {running ? "Updating…" : "Update Sheet"}
        </button>
      </div>
      {result && result.failed > 0 && result.firstError && (
        <span className="max-w-md text-right text-sm text-red-600">{result.firstError}</span>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
