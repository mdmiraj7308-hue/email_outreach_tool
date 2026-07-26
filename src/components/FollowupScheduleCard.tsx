"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, card, input as inputClass } from "@/lib/ui";
import { toLocalInputValue } from "@/lib/dateInput";

export function FollowupScheduleCard({
  leadId,
  followup2ScheduledFor,
  followup3ScheduledFor,
}: {
  leadId: string;
  followup2ScheduledFor: string | null;
  followup3ScheduledFor: string | null;
}) {
  const router = useRouter();
  const [f2, setF2] = useState(toLocalInputValue(followup2ScheduledFor));
  const [f3, setF3] = useState(toLocalInputValue(followup3ScheduledFor));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          followup2ScheduledFor: f2 || null,
          followup3ScheduledFor: f3 || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setMessage("Saved.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? `Error: ${err.message}` : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={card}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
        Follow-up Schedule Override
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Set an exact date/time for follow-up 2 and 3 — any minute or hour, not just whole days.
        Leave a field blank to use the default spacing from Settings instead.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            2nd Follow-up
          </label>
          <input
            type="datetime-local"
            value={f2}
            onChange={(e) => setF2(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            3rd Follow-up
          </label>
          <input
            type="datetime-local"
            value={f3}
            onChange={(e) => setF3(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={handleSave} disabled={saving} className={btnPrimary}>
          {saving ? "Saving…" : "Save"}
        </button>
        {message && <span className="text-sm text-[var(--ink-soft)]">{message}</span>}
      </div>
    </div>
  );
}
