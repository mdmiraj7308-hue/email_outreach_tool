"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnGhost, input as inputClass } from "@/lib/ui";

export function CreateCampaignButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetCount, setTargetCount] = useState(20);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableCount, setAvailableCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setAvailableCount(null);
    fetch("/api/sending-campaigns/fresh-pool-count")
      .then((r) => r.json())
      .then((data) => setAvailableCount(data.count))
      .catch(() => {});
  }, [open]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sending-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCount }),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error("The server returned an unexpected response — please try again.");
      if (!res.ok) throw new Error(data.error ?? "Failed to create campaign");
      router.push(`/sending-campaigns/${data.campaignId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setCreating(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btnPrimary}>
        Create Campaign
      </button>
    );
  }

  const requestingMoreThanAvailable =
    availableCount !== null && targetCount > availableCount && availableCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 backdrop-blur-sm">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Create Campaign</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Pulls fresh qualified leads (never used in a campaign before), hottest fit-score
            first, and assigns them evenly across your active Gmail accounts. You&apos;ll write
            the emails on the campaign&apos;s own page after reviewing the list.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">How many leads?</label>
          <input
            type="number"
            min={1}
            value={targetCount}
            onChange={(e) => setTargetCount(Number(e.target.value))}
            className={inputClass}
          />
          <p className="text-xs text-[var(--ink-soft)]">
            {availableCount === null
              ? "Checking how many fresh leads are available…"
              : availableCount === 0
                ? "No fresh qualified leads available right now — enrich more first."
                : `${availableCount} fresh qualified lead${availableCount === 1 ? "" : "s"} available.`}
          </p>
          {requestingMoreThanAvailable && (
            <p className="text-xs text-amber-600">
              Only {availableCount} will be used — that&apos;s all that&apos;s available right now.
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => setOpen(false)} disabled={creating} className={btnGhost}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || availableCount === 0}
            className={btnPrimary}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
