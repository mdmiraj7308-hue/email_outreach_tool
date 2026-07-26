"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnGhost, input as inputClass } from "@/lib/ui";

export function WriteEmailsAndUploadButton({ campaignRunId }: { campaignRunId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/runs/${campaignRunId}/write-and-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customSystemPrompt: customPrompt.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to write emails");
      setMessage(
        `${data.drafted} drafted, ${data.failed} failed${
          data.duplicatesSkipped > 0 ? `, ${data.duplicatesSkipped} skipped as duplicates` : ""
        }${data.total === 0 && data.duplicatesSkipped === 0 ? " (no qualified leads)" : ""}. Drafting no longer needs to be triggered manually — leads draft automatically once enrichment qualifies them. Use this only to retry any that failed to auto-draft.`
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? `Error: ${err.message}` : "Failed to write emails");
    } finally {
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btnGhost}>
        Retry failed drafts
      </button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-2 rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <p className="text-xs text-[var(--ink-soft)]">
        Leads draft automatically once enrichment qualifies them (email found + fit ≥ 50) —
        nothing to trigger normally. Use this only to retry qualified leads whose auto-draft
        failed (e.g. a transient API error).
      </p>
      <label className="text-sm font-medium text-[var(--ink)]">
        Optional: override instructions for this retry
      </label>
      <textarea
        value={customPrompt}
        onChange={(e) => setCustomPrompt(e.target.value)}
        placeholder="Leave blank to use your saved default instructions from Settings."
        rows={4}
        className={inputClass}
      />
      <div className="flex items-center gap-2">
        <button onClick={handleRun} disabled={running} className={btnPrimary}>
          {running ? "Retrying…" : "Retry failed drafts"}
        </button>
        <button onClick={() => setOpen(false)} disabled={running} className={btnGhost}>
          Cancel
        </button>
      </div>
      {message && <p className="text-sm text-[var(--ink-soft)]">{message}</p>}
    </div>
  );
}
