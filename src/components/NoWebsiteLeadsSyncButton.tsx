"use client";

import { useState } from "react";
import { btnSecondary } from "@/lib/ui";

/**
 * Manual catch-up for the "No Website Leads" sheet tab — insert-time sync
 * (in scrapeRun.ts) is best-effort and never retries on its own, so a bad
 * Sheets connection at scrape time leaves records stuck unsynced forever
 * unless something explicitly re-tries them. Safe to click repeatedly:
 * only ever pushes rows not yet marked synced.
 */
export function NoWebsiteLeadsSyncButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ total: number; synced: number; error?: string } | null>(null);

  async function handleClick() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/no-website-leads/sync", { method: "POST" });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ total: 0, synced: 0, error: err instanceof Error ? err.message : "Failed to sync" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-[var(--border)] p-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
        No Website Leads
      </p>
      <p className="text-xs text-[var(--ink-soft)]">
        Pushes any businesses with no website that never made it to the &quot;No Website
        Leads&quot; sheet tab (e.g. from a Sheets connection issue at scrape time).
      </p>
      <button onClick={handleClick} disabled={running} className={btnSecondary}>
        {running ? "Syncing…" : "Sync No-Website Leads"}
      </button>
      {result && (
        <p className={`text-sm ${result.error ? "text-red-600" : "text-[var(--ink-soft)]"}`}>
          {result.error
            ? result.error
            : result.total === 0
              ? "Nothing to sync — already up to date."
              : `Synced ${result.synced} of ${result.total}.`}
        </p>
      )}
    </div>
  );
}
