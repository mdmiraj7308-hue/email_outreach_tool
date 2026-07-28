"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnGhost, input as inputClass } from "@/lib/ui";

async function fetchProgress(campaignRunId: string): Promise<{ qualifiedTotal: number; qualifiedDrafted: number }> {
  const res = await fetch(`/api/runs/${campaignRunId}/progress`);
  if (!res.ok) throw new Error("Failed to fetch progress");
  return res.json();
}

export function WriteEmailsAndUploadButton({ campaignRunId }: { campaignRunId: string }) {
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [result, setResult] = useState<{ drafted: number; failed: number; duplicatesSkipped: number } | null>(
    null
  );
  const [nothingToDraft, setNothingToDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount (and whenever the page re-renders this fresh, e.g. after an
  // enrichment run adds newly-qualified leads), check whether there's
  // actually anything left to draft — lets the button start out disabled
  // when everything currently qualified already has its 3 emails.
  useEffect(() => {
    let cancelled = false;
    fetchProgress(campaignRunId)
      .then(({ qualifiedTotal, qualifiedDrafted }) => {
        if (!cancelled) setNothingToDraft(qualifiedTotal > 0 && qualifiedDrafted >= qualifiedTotal);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignRunId]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleRun() {
    setRunning(true);
    setResult(null);
    setError(null);
    setPercent(0);

    try {
      const { qualifiedTotal, qualifiedDrafted } = await fetchProgress(campaignRunId);
      const baselineRemaining = Math.max(0, qualifiedTotal - qualifiedDrafted);

      if (baselineRemaining > 0) {
        pollRef.current = setInterval(async () => {
          try {
            const { qualifiedDrafted: draftedNow } = await fetchProgress(campaignRunId);
            const completedSoFar = Math.max(0, draftedNow - qualifiedDrafted);
            setPercent(Math.min(99, Math.round((completedSoFar / baselineRemaining) * 100)));
          } catch {
            // transient — next tick will retry
          }
        }, 1500);
      } else {
        setPercent(100);
      }

      const res = await fetch(`/api/runs/${campaignRunId}/write-and-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customSystemPrompt: customPrompt.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to write emails");

      stopPolling();
      setPercent(100);
      setResult({ drafted: data.drafted, failed: data.failed, duplicatesSkipped: data.duplicatesSkipped });

      // Re-check against the real, current state rather than assuming —
      // a partial failure (data.failed > 0) should leave it re-clickable.
      fetchProgress(campaignRunId)
        .then(({ qualifiedTotal, qualifiedDrafted }) =>
          setNothingToDraft(qualifiedTotal > 0 && qualifiedDrafted >= qualifiedTotal)
        )
        .catch(() => {});

      router.refresh();
    } catch (err) {
      stopPolling();
      setError(err instanceof Error ? err.message : "Failed to write emails");
    } finally {
      setRunning(false);
    }
  }

  const disabled = running || nothingToDraft;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {result && !running && (
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            Completed — {result.drafted} drafted &amp; synced to sheet
            {result.failed > 0 ? `, ${result.failed} failed` : ""}
            {result.duplicatesSkipped > 0 ? `, ${result.duplicatesSkipped} skipped as duplicates` : ""}
          </span>
        )}
        {!result && nothingToDraft && !running && (
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            All qualified leads are already drafted.
          </span>
        )}
        <button onClick={() => setShowAdvanced((v) => !v)} disabled={running} className={btnGhost}>
          {showAdvanced ? "Hide options" : "Options"}
        </button>
        <button onClick={handleRun} disabled={disabled} className={btnPrimary}>
          {running ? `Writing… ${percent}%` : "Write emails + 2 follow-ups + update sheet"}
        </button>
      </div>
      {running && (
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {showAdvanced && !running && (
        <div className="w-full max-w-md space-y-2 rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-xs text-[var(--ink-soft)]">
            Drafts any qualified lead (email found + fit ≥ 50) that doesn&apos;t already have all 3
            emails drafted, then re-syncs the Sheet. Leads already drafted are left untouched.
          </p>
          <label className="text-sm font-medium text-[var(--ink)]">
            Optional: override instructions for this run
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Leave blank to use your saved default instructions from Settings."
            rows={4}
            className={inputClass}
          />
        </div>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
