"use client";

import { useEffect, useRef, useState } from "react";
import { btnPrimary, btnSecondary, btnGhost, card, statusBadgeClass, spamScoreBadge, badgeClass, input as inputClass } from "@/lib/ui";
import { toLocalInputValue } from "@/lib/dateInput";

export interface TodaySendItem {
  sendId: string;
  leadId: string;
  businessName: string;
  primaryEmail: string;
  aboutSummary: string | null;
  sequence: number;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  senderEmail: string | null;
  sentManually: boolean;
  followup2ScheduledFor: string | null;
  followup3ScheduledFor: string | null;
  draft: { id: string; subject: string; body: string };
  liveSpamScore: { score: number; flags: string[] };
}

interface EditState {
  to: string;
  subject: string;
  body: string;
  followup2: string;
  followup3: string;
}

const BUCKET_LABEL: Record<string, string> = {
  first: "first email",
  followup1: "2nd follow-up",
  followup2: "3rd follow-up",
};

export function TodaySendingView({
  bucket,
  initialItems,
}: {
  bucket: "first" | "followup1" | "followup2";
  initialItems: TodaySendItem[];
}) {
  const [items, setItems] = useState<TodaySendItem[]>(initialItems);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [sendingNow, setSendingNow] = useState<string | null>(null);
  const [liveScores, setLiveScores] = useState<Record<string, { score: number; flags: string[] }>>({});
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const hasSendable = items.some((i) => i.status === "ready" || i.status === "scheduled");

  async function refresh() {
    const res = await fetch(`/api/today-sends?bucket=${bucket}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
    }
  }

  // Only "scheduled" items are actively in flight and need polling —
  // "ready" ones just sit until you act, no need to keep re-fetching.
  const hasInFlight = items.some((i) => i.status === "scheduled");

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInFlight, bucket]);

  function currentEdit(item: TodaySendItem): EditState {
    return (
      editing[item.sendId] ?? {
        to: item.primaryEmail,
        subject: item.draft.subject,
        body: item.draft.body,
        followup2: toLocalInputValue(item.followup2ScheduledFor),
        followup3: toLocalInputValue(item.followup3ScheduledFor),
      }
    );
  }

  function updateField(item: TodaySendItem, field: keyof EditState, value: string) {
    const next = { ...currentEdit(item), [field]: value };
    setEditing((prev) => ({ ...prev, [item.sendId]: next }));

    if (field !== "subject" && field !== "body") return; // only subject/body factor into the spam-content score
    clearTimeout(debounceRef.current[item.sendId]);
    debounceRef.current[item.sendId] = setTimeout(async () => {
      const res = await fetch("/api/spam-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: next.subject, body: next.body }),
      });
      if (res.ok) {
        const score = await res.json();
        setLiveScores((prev) => ({ ...prev, [item.sendId]: score }));
      }
    }, 300);
  }

  async function handleSave(item: TodaySendItem) {
    const edited = editing[item.sendId];
    if (!edited) return;
    setSaving(item.sendId);
    try {
      const emailChanged = edited.to !== item.primaryEmail;
      const draftChanged = edited.subject !== item.draft.subject || edited.body !== item.draft.body;
      const followup2Changed = edited.followup2 !== toLocalInputValue(item.followup2ScheduledFor);
      const followup3Changed = edited.followup3 !== toLocalInputValue(item.followup3ScheduledFor);
      const leadFieldsChanged = emailChanged || followup2Changed || followup3Changed;

      const results = await Promise.all([
        draftChanged
          ? fetch(`/api/drafts/${item.draft.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ subject: edited.subject, body: edited.body }),
            }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
          : null,
        leadFieldsChanged
          ? fetch(`/api/leads/${item.leadId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(emailChanged ? { primaryEmail: edited.to } : {}),
                ...(followup2Changed ? { followup2ScheduledFor: edited.followup2 || null } : {}),
                ...(followup3Changed ? { followup3ScheduledFor: edited.followup3 || null } : {}),
              }),
            }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
          : null,
      ]);

      const failed = results.find((r) => r && !r.ok);
      if (failed) throw new Error(failed.data.error ?? "Failed to save");

      const sheetSync = results.find((r) => r?.data?.sheetSync)?.data.sheetSync;
      setSaveMessage((prev) => ({
        ...prev,
        [item.sendId]: sheetSync?.ok
          ? "Saved and synced to Sheet."
          : sheetSync
            ? `Saved, but Sheet sync failed: ${sheetSync.error ?? sheetSync.reason ?? "unknown"}`
            : "Saved.",
      }));
      setEditing((prev) => {
        const next = { ...prev };
        delete next[item.sendId];
        return next;
      });
      await refresh();
    } catch (err) {
      setSaveMessage((prev) => ({
        ...prev,
        [item.sendId]: err instanceof Error ? `Error: ${err.message}` : "Failed to save",
      }));
    } finally {
      setSaving(null);
    }
  }

  async function handleSendNow(item: TodaySendItem) {
    setSendingNow(item.sendId);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: item.leadId, sequence: item.sequence }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      if (data.status === "failed") throw new Error(data.error ?? "Send failed");
      setSaveMessage((prev) => ({
        ...prev,
        [item.sendId]:
          data.status === "deferred" ? `Deferred: ${data.reason}` : `Sent via ${data.senderEmail}.`,
      }));
      await refresh();
    } catch (err) {
      setSaveMessage((prev) => ({
        ...prev,
        [item.sendId]: err instanceof Error ? `Error: ${err.message}` : "Failed to send",
      }));
    } finally {
      setSendingNow(null);
    }
  }

  async function handleStartSending() {
    setStarting(true);
    try {
      await fetch("/api/today-sends/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket }),
      });
      await refresh();
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--ink-soft)]">
          {items.length} lead{items.length === 1 ? "" : "s"} in today's {BUCKET_LABEL[bucket]} batch
        </p>
        <button onClick={handleStartSending} disabled={starting || !hasSendable} className={btnPrimary}>
          {starting ? "Starting…" : "Start Sending"}
        </button>
      </div>
      {hasSendable && (
        <p className="text-xs text-[var(--ink-soft)]">
          Nothing sends until you click Start Sending — then they go out one at a time with a
          random pause between each, not all at once.
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center text-sm text-[var(--ink-soft)]">
          Nothing ready to send in this bucket yet.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isOpen = expanded === item.sendId;
            const edited = editing[item.sendId];
            const to = edited?.to ?? item.primaryEmail;
            const subject = edited?.subject ?? item.draft.subject;
            const body = edited?.body ?? item.draft.body;
            const followup2 = edited?.followup2 ?? toLocalInputValue(item.followup2ScheduledFor);
            const followup3 = edited?.followup3 ?? toLocalInputValue(item.followup3ScheduledFor);
            const score = liveScores[item.sendId] ?? item.liveSpamScore;
            const spamBadge = spamScoreBadge(score.score);

            return (
              <div key={item.sendId} className={card}>
                <button
                  onClick={() => setExpanded(isOpen ? null : item.sendId)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <p className="font-medium text-[var(--ink)]">{item.businessName}</p>
                    <p className="text-sm text-[var(--ink-soft)]">{item.primaryEmail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={spamBadge.className}>{spamBadge.label}</span>
                    {item.status === "sent" && item.sentManually ? (
                      <span className={badgeClass("red")} title="Sent individually via Send Now — Start Sending will skip this">
                        sent (manual)
                      </span>
                    ) : (
                      <span className={statusBadgeClass(item.status)}>{item.status}</span>
                    )}
                    {item.senderEmail && (
                      <span className="text-sm text-[var(--ink-soft)]">via {item.senderEmail}</span>
                    )}
                  </div>
                </button>

                {item.aboutSummary && (
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">{item.aboutSummary}</p>
                )}

                {isOpen && (
                  <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                    <div className="rounded-xl border border-[var(--border)] bg-neutral-50 p-4">
                      <p className="font-semibold text-[var(--ink)]">{subject}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">{body}</p>
                    </div>

                    {score.flags.length > 0 && (
                      <p className="text-xs text-amber-700">Flags: {score.flags.join(", ")}</p>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                        To
                      </label>
                      <input
                        value={to}
                        onChange={(e) => updateField(item, "to", e.target.value)}
                        className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                        Subject
                      </label>
                      <input
                        value={subject}
                        onChange={(e) => updateField(item, "subject", e.target.value)}
                        className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                        Body
                      </label>
                      <textarea
                        value={body}
                        onChange={(e) => updateField(item, "body", e.target.value)}
                        rows={8}
                        className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 font-mono text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]"
                      />
                    </div>

                    <div className="rounded-xl border border-[var(--border)] p-3.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                        Follow-up schedule override
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                        Pick an exact date/time (any minute, hour, or day) for this lead's
                        follow-ups — leave blank to use the default spacing from Settings.
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-[var(--ink-soft)]">
                            2nd follow-up
                          </label>
                          <input
                            type="datetime-local"
                            value={followup2}
                            onChange={(e) => updateField(item, "followup2", e.target.value)}
                            className={inputClass}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-[var(--ink-soft)]">
                            3rd follow-up
                          </label>
                          <input
                            type="datetime-local"
                            value={followup3}
                            onChange={(e) => updateField(item, "followup3", e.target.value)}
                            className={inputClass}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSave(item)}
                        disabled={saving === item.sendId || !edited}
                        className={btnSecondary}
                      >
                        {saving === item.sendId ? "Saving…" : "Save"}
                      </button>
                      {item.status !== "scheduled" && (
                        <button
                          onClick={() => handleSendNow(item)}
                          disabled={sendingNow === item.sendId || !!edited}
                          title={
                            edited
                              ? "Save your changes first"
                              : `Send immediately to ${to} (bypasses the batch pacing)`
                          }
                          className={btnPrimary}
                        >
                          {sendingNow === item.sendId ? "Sending…" : "Send Now"}
                        </button>
                      )}
                      <button onClick={() => setExpanded(null)} className={btnGhost}>
                        Close
                      </button>
                    </div>
                    {saveMessage[item.sendId] && (
                      <p className="text-sm text-[var(--ink-soft)]">{saveMessage[item.sendId]}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
