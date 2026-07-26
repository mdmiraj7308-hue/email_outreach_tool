"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, card, statusBadgeClass } from "@/lib/ui";

export interface DraftData {
  id: string;
  sequence: number;
  purpose: string;
  subject: string;
  body: string;
}

const TAB_LABELS: Record<number, string> = {
  1: "Cold Email",
  2: "Follow-up 1",
  3: "Follow-up 2",
};

export interface SendStatus {
  sequence: number;
  status: string;
  senderEmail: string | null;
}

export function EmailDraftsPanel({
  leadId,
  drafts,
  sends,
  canGenerate,
}: {
  leadId: string;
  drafts: DraftData[];
  sends: SendStatus[];
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [activeSeq, setActiveSeq] = useState(1);
  const [editing, setEditing] = useState<Record<number, { subject: string; body: string }>>({});
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const activeSend = sends.find((s) => s.sequence === activeSeq);
  const canSend = !activeSend || activeSend.status === "failed";

  async function handleSendNow() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, sequence: activeSeq }),
      });
      const data = await res.json();
      if (data.status === "failed") throw new Error(data.error);
      if (data.status === "deferred") {
        setError(`Deferred: ${data.reason}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const draft = drafts.find((d) => d.sequence === activeSeq);
  const edited = editing[activeSeq];
  const subject = edited?.subject ?? draft?.subject ?? "";
  const bodyText = edited?.body ?? draft?.body ?? "";

  function updateField(field: "subject" | "body", value: string) {
    setEditing((prev) => ({
      ...prev,
      [activeSeq]: {
        subject: field === "subject" ? value : (prev[activeSeq]?.subject ?? draft?.subject ?? ""),
        body: field === "body" ? value : (prev[activeSeq]?.body ?? draft?.body ?? ""),
      },
    }));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body: bodyText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setEditing((prev) => {
        const next = { ...prev };
        delete next[activeSeq];
        return next;
      });
      setSaveMessage(
        data.sheetSync?.ok
          ? "Saved and synced to Sheet."
          : `Saved, but Sheet sync failed: ${data.sheetSync?.error ?? data.sheetSync?.reason ?? "unknown reason"}`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate emails");
      setEditing({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate emails");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={`${card} space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
          Email Drafts
        </h2>
        <button
          onClick={handleGenerate}
          disabled={generating || !canGenerate}
          className={btnSecondary}
          title={!canGenerate ? "Run enrichment first to get an About Summary" : undefined}
        >
          {generating ? "Generating…" : drafts.length > 0 ? "Regenerate All" : "Generate Drafts"}
        </button>
      </div>

      {!canGenerate && drafts.length === 0 && (
        <p className="text-sm text-[var(--ink-soft)]">
          Run enrichment on this lead first so there's an About Summary to write from.
        </p>
      )}

      {drafts.length > 0 && (
        <>
          <div className="flex gap-1.5 rounded-full bg-neutral-100 p-1">
            {[1, 2, 3].map((seq) => {
              const s = sends.find((x) => x.sequence === seq);
              return (
                <button
                  key={seq}
                  onClick={() => setActiveSeq(seq)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    activeSeq === seq
                      ? "bg-white text-[var(--ink)] shadow-sm"
                      : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                  }`}
                >
                  {TAB_LABELS[seq]}
                  {s && s.status !== "failed" && (
                    <span className={`${statusBadgeClass(s.status)} ml-1.5`}>{s.status}</span>
                  )}
                </button>
              );
            })}
          </div>

          {draft ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={(e) => updateField("subject", e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                  Body
                </label>
                <textarea
                  value={bodyText}
                  onChange={(e) => updateField("body", e.target.value)}
                  rows={10}
                  className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 font-mono text-sm outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSave} disabled={saving} className={btnPrimary}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={handleSendNow}
                  disabled={sending || !canSend}
                  className={btnSecondary}
                  title={!canSend ? `Already ${activeSend?.status}` : undefined}
                >
                  {sending ? "Sending…" : "Send Now"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-soft)]">No draft for this sequence yet.</p>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saveMessage && !error && <p className="text-sm text-[var(--ink-soft)]">{saveMessage}</p>}
    </div>
  );
}
