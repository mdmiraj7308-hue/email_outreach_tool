"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, btnGhost, card, badgeClass } from "@/lib/ui";

interface Draft {
  id: string;
  sequence: number;
  subject: string;
  body: string;
}

export interface CampaignLead {
  campaignLeadId: string;
  leadId: string;
  businessName: string;
  primaryEmail: string;
  aboutSummary: string | null;
  senderEmail: string;
  drafts: Draft[];
}

const SEQUENCE_LABEL: Record<number, string> = { 1: "Cold email", 2: "Follow-up 2", 3: "Follow-up 3" };

interface DraftEdit {
  subject: string;
  body: string;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label}`}
      className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--ink-soft)] transition hover:bg-neutral-50"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function draftKey(leadId: string, sequence: number): string {
  return `${leadId}:${sequence}`;
}

export function SendingCampaignView({
  campaignId,
  status,
  initialLeads,
  followupEnabled,
  followup2Enabled,
}: {
  campaignId: string;
  status: string;
  initialLeads: CampaignLead[];
  followupEnabled: boolean;
  followup2Enabled: boolean;
}) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openSequence, setOpenSequence] = useState<Record<string, number>>({});
  const [toEdits, setToEdits] = useState<Record<string, string>>({});
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftEdit>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  const isDraftStatus = status === "draft";
  // Only sequences that can actually send matter — no point requiring (or
  // even showing) follow-up drafts while that stage is off in Settings.
  const visibleSequences = [1, ...(followupEnabled ? [2] : []), ...(followupEnabled && followup2Enabled ? [3] : [])];

  function isLeadFullyDrafted(lead: CampaignLead): boolean {
    return visibleSequences.every((seq) => lead.drafts.some((d) => d.sequence === seq));
  }
  const undraftedCount = leads.filter((l) => !isLeadFullyDrafted(l)).length;

  function currentTo(lead: CampaignLead): string {
    return toEdits[lead.leadId] ?? lead.primaryEmail;
  }
  function currentDraft(leadId: string, sequence: number, existing: Draft | undefined): DraftEdit {
    return (
      draftEdits[draftKey(leadId, sequence)] ?? {
        subject: existing?.subject ?? "",
        body: existing?.body ?? "",
      }
    );
  }

  async function handleSaveLead(lead: CampaignLead) {
    setSaving(lead.leadId);
    try {
      const emailChanged = toEdits[lead.leadId] !== undefined && toEdits[lead.leadId] !== lead.primaryEmail;

      const draftSaves = visibleSequences
        .map((seq) => {
          const existing = lead.drafts.find((d) => d.sequence === seq);
          const edit = draftEdits[draftKey(lead.leadId, seq)];
          if (!edit) return null; // untouched — nothing to save for this sequence
          if (existing && edit.subject === existing.subject && edit.body === existing.body) return null;
          if (!edit.subject.trim() || !edit.body.trim()) return null; // don't save blank content
          return { seq, existing, edit };
        })
        .filter((x): x is { seq: number; existing: Draft | undefined; edit: DraftEdit } => x !== null);

      const results = await Promise.all([
        emailChanged
          ? fetch(`/api/leads/${lead.leadId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ primaryEmail: toEdits[lead.leadId] }),
            }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
          : null,
        ...draftSaves.map(({ seq, existing, edit }) =>
          existing
            ? fetch(`/api/drafts/${existing.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(edit),
              }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
            : fetch(`/api/leads/${lead.leadId}/manual-draft`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sequence: seq, ...edit }),
              }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        ),
      ]);

      const failed = results.find((r) => r && !r.ok);
      if (failed) throw new Error(failed.data?.error ?? "Failed to save");

      const savedDrafts = results.slice(1).filter((r): r is { ok: true; data: Draft } => !!r && r.ok);
      if (savedDrafts.length > 0) {
        setLeads((prev) =>
          prev.map((l) => {
            if (l.leadId !== lead.leadId) return l;
            const nextDrafts = [...l.drafts];
            for (const { data } of savedDrafts) {
              const i = nextDrafts.findIndex((d) => d.sequence === data.sequence);
              if (i >= 0) nextDrafts[i] = data;
              else nextDrafts.push(data);
            }
            return { ...l, drafts: nextDrafts };
          })
        );
      }
      setDraftEdits((prev) => {
        const next = { ...prev };
        for (const { seq } of draftSaves) delete next[draftKey(lead.leadId, seq)];
        return next;
      });

      setSaveMessage((prev) => ({ ...prev, [lead.leadId]: "Saved." }));
      router.refresh();
    } catch (err) {
      setSaveMessage((prev) => ({
        ...prev,
        [lead.leadId]: err instanceof Error ? `Error: ${err.message}` : "Failed to save",
      }));
    } finally {
      setSaving(null);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setConfirmMessage(null);
    try {
      const res = await fetch(`/api/sending-campaigns/${campaignId}/confirm`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to confirm");
      setConfirmMessage(`Confirmed — ${data.scheduled} email${data.scheduled === 1 ? "" : "s"} scheduled.`);
      router.refresh();
    } catch (err) {
      setConfirmMessage(err instanceof Error ? `Error: ${err.message}` : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--ink-soft)]">
          {leads.length} lead{leads.length === 1 ? "" : "s"} in this campaign
        </p>
        {isDraftStatus ? (
          <button
            onClick={handleConfirm}
            disabled={confirming || undraftedCount > 0}
            title={undraftedCount > 0 ? "Write emails for every lead first" : undefined}
            className={btnPrimary}
          >
            {confirming ? "Confirming…" : "Confirm & Schedule"}
          </button>
        ) : (
          <span className={badgeClass("green")}>{status}</span>
        )}
      </div>
      {isDraftStatus && (
        <p className="text-xs text-[var(--ink-soft)]">
          Audit the list below, then expand each lead and write its email{visibleSequences.length > 1 ? "s" : ""}{" "}
          before confirming. Nothing is scheduled until you click Confirm & Schedule — sending then
          happens automatically within business hours, paced across your connected accounts.
          {!followupEnabled && " Follow-ups are off in Settings, so only the cold email is needed."}
          {undraftedCount > 0 &&
            ` ${undraftedCount} of ${leads.length} lead${undraftedCount === 1 ? "" : "s"} still need${undraftedCount === 1 ? "s" : ""} emails written.`}
        </p>
      )}
      {confirmMessage && <p className="text-sm text-[var(--ink-soft)]">{confirmMessage}</p>}

      <div className="space-y-3">
        {leads.map((lead) => {
          const isOpen = expanded === lead.leadId;
          const to = currentTo(lead);
          const activeSequence = openSequence[lead.leadId] ?? 1;
          const activeDraft = lead.drafts.find((d) => d.sequence === activeSequence);
          const activeEdit = currentDraft(lead.leadId, activeSequence, activeDraft);

          return (
            <div key={lead.leadId} className={card}>
              <div
                onClick={() => setExpanded(isOpen ? null : lead.leadId)}
                className="flex w-full cursor-pointer items-center justify-between text-left"
              >
                <div>
                  <p className="font-medium text-[var(--ink)]">{lead.businessName}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="text-sm text-[var(--ink-soft)]">{lead.primaryEmail}</p>
                    <CopyButton text={lead.primaryEmail} label="email address" />
                  </div>
                </div>
                <span className="shrink-0 text-sm text-[var(--ink-soft)]">via {lead.senderEmail}</span>
              </div>

              {lead.aboutSummary && (
                <div className="mt-2 flex items-start gap-2">
                  <p className="flex-1 text-sm text-[var(--ink-soft)]">{lead.aboutSummary}</p>
                  <CopyButton text={lead.aboutSummary} label="summary" />
                </div>
              )}

              {isOpen && (
                <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                      To
                    </label>
                    <input
                      value={to}
                      onChange={(e) => setToEdits((prev) => ({ ...prev, [lead.leadId]: e.target.value }))}
                      disabled={!isDraftStatus}
                      className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)] disabled:bg-neutral-50"
                    />
                  </div>

                  {visibleSequences.length > 1 && (
                    <div className="flex gap-2">
                      {visibleSequences.map((seq) => {
                        const hasContent = lead.drafts.some((d) => d.sequence === seq);
                        return (
                          <button
                            key={seq}
                            type="button"
                            onClick={() => setOpenSequence((prev) => ({ ...prev, [lead.leadId]: seq }))}
                            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                              activeSequence === seq
                                ? "bg-[var(--brand)] text-white"
                                : "border border-[var(--border)] text-[var(--ink-soft)] hover:bg-neutral-50"
                            }`}
                          >
                            {SEQUENCE_LABEL[seq] ?? `Sequence ${seq}`}
                            {!hasContent && " (empty)"}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                      Subject
                    </label>
                    <input
                      value={activeEdit.subject}
                      disabled={!isDraftStatus}
                      placeholder="Write the subject line…"
                      onChange={(e) =>
                        setDraftEdits((prev) => ({
                          ...prev,
                          [draftKey(lead.leadId, activeSequence)]: { ...activeEdit, subject: e.target.value },
                        }))
                      }
                      className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)] disabled:bg-neutral-50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                      Body
                    </label>
                    <textarea
                      value={activeEdit.body}
                      disabled={!isDraftStatus}
                      placeholder="Write the email body…"
                      onChange={(e) =>
                        setDraftEdits((prev) => ({
                          ...prev,
                          [draftKey(lead.leadId, activeSequence)]: { ...activeEdit, body: e.target.value },
                        }))
                      }
                      rows={8}
                      className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 font-mono text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)] disabled:bg-neutral-50"
                    />
                  </div>

                  {isDraftStatus && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveLead(lead)}
                        disabled={saving === lead.leadId}
                        className={btnSecondary}
                      >
                        {saving === lead.leadId ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setExpanded(null)} className={btnGhost}>
                        Close
                      </button>
                    </div>
                  )}
                  {saveMessage[lead.leadId] && (
                    <p className="text-sm text-[var(--ink-soft)]">{saveMessage[lead.leadId]}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
