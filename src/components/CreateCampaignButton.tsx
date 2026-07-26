"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnGhost, input as inputClass } from "@/lib/ui";

export function CreateCampaignButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetCount, setTargetCount] = useState(20);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sending-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCount }),
      });
      const data = await res.json();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 backdrop-blur-sm">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Create Campaign</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Pulls fresh qualified leads (never used in a campaign before), hottest fit-score
            first, and assigns them evenly across your active Gmail accounts.
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
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => setOpen(false)} disabled={creating} className={btnGhost}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={creating} className={btnPrimary}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
