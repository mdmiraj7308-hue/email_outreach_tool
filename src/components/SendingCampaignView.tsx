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

export function SendingCampaignView({
  campaignId,
  status,
  initialLeads,
}: {
  campaignId: string;
  status: string;
  initialLeads: CampaignLead[];
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
  const [rewriteFeedback, setRewriteFeedback] = useState<Record<string, string>>({});
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [rewriteMessage, setRewriteMessage] = useState<Record<string, string>>({});
  const [writingAll, setWritingAll] = useState(false);
  const [writeAllMessage, setWriteAllMessage] = useState<string | null>(null);

  const isDraftStatus = status === "draft";
  const undraftedCount = leads.filter((l) => l.drafts.length < 3).length;

  function currentTo(lead: CampaignLead): string {
    return toEdits[lead.leadId] ?? lead.primaryEmail;
  }
  function currentDraft(draft: Draft): DraftEdit {
    return draftEdits[draft.id] ?? { subject: draft.subject, body: draft.body };
  }

  async function handleSaveLead(lead: CampaignLead) {
    setSaving(lead.leadId);
    try {
      const emailChanged = toEdits[lead.leadId] !== undefined && toEdits[lead.leadId] !== lead.primaryEmail;
      const changedDrafts = lead.drafts.filter((d) => {
        const edit = draftEdits[d.id];
        return edit && (edit.subject !== d.subject || edit.body !== d.body);
      });

      const results = await Promise.all([
        emailChanged
          ? fetch(`/api/leads/${lead.leadId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ primaryEmail: toEdits[lead.leadId] }),
            }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
          : null,
        ...changedDrafts.map((d) =>
          fetch(`/api/drafts/${d.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draftEdits[d.id]),
          }).then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        ),
      ]);

      const failed = results.find((r) => r && !r.ok);
      if (failed) throw new Error(failed.data?.error ?? "Failed to save");

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

  async function handleRewrite(lead: CampaignLead) {
    setRewriting(lead.leadId);
    setRewriteMessage((prev) => ({ ...prev, [lead.leadId]: "" }));
    try {
      const res = await fetch(`/api/leads/${lead.leadId}/rewrite-emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: rewriteFeedback[lead.leadId] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to rewrite");

      const newDrafts = data.drafts as { id: string; subject: string; body: string }[];
      setDraftEdits((prev) => {
        const next = { ...prev };
        for (const d of newDrafts) {
          next[d.id] = { subject: d.subject, body: d.body };
        }
        return next;
      });
      setRewriteMessage((prev) => ({ ...prev, [lead.leadId]: "Rewritten — review the cold email and both follow-ups below." }));
    } catch (err) {
      setRewriteMessage((prev) => ({
        ...prev,
        [lead.leadId]: err instanceof Error ? `Error: ${err.message}` : "Failed to rewrite",
      }));
    } finally {
      setRewriting(null);
    }
  }

  async function handleWriteAll() {
    setWritingAll(true);
    setWriteAllMessage(null);
    try {
      const res = await fetch(`/api/sending-campaigns/${campaignId}/write-emails`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to write emails");

      const results = data.results as {
        leadId: string;
        ok: boolean;
        drafts?: Draft[];
        error?: string;
      }[];
      setLeads((prev) =>
        prev.map((lead) => {
          const r = results.find((x) => x.leadId === lead.leadId);
          return r?.ok && r.drafts ? { ...lead, drafts: r.drafts } : lead;
        })
      );
      const failedCount = results.filter((r) => !r.ok).length;
      setWriteAllMessage(
        failedCount > 0
          ? `Wrote emails for ${results.length - failedCount}/${results.length} leads — ${failedCount} failed.`
          : `Wrote emails for all ${results.length} leads.`
      );
    } catch (err) {
      setWriteAllMessage(err instanceof Error ? `Error: ${err.message}` : "Failed to write emails");
    } finally {
      setWritingAll(false);
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
          <div className="flex items-center gap-2">
            <button onClick={handleWriteAll} disabled={writingAll} className={btnSecondary}>
              {writingAll ? "Writing…" : "Write emails + 2 follow-ups"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming || undraftedCount > 0}
              title={undraftedCount > 0 ? "Write emails for every lead first" : undefined}
              className={btnPrimary}
            >
              {confirming ? "Confirming…" : "Confirm & Schedule"}
            </button>
          </div>
        ) : (
          <span className={badgeClass("green")}>{status}</span>
        )}
      </div>
      {isDraftStatus && (
        <p className="text-xs text-[var(--ink-soft)]">
          Audit the list below, click Write emails + 2 follow-ups to draft the cold email and both
          follow-ups for every lead, then review/edit before confirming. Nothing is scheduled
          until you click Confirm & Schedule — sending then happens automatically within business
          hours, paced across your connected accounts.
          {undraftedCount > 0 &&
            ` ${undraftedCount} of ${leads.length} lead${undraftedCount === 1 ? "" : "s"} still need${undraftedCount === 1 ? "s" : ""} emails written.`}
        </p>
      )}
      {writeAllMessage && <p className="text-sm text-[var(--ink-soft)]">{writeAllMessage}</p>}
      {confirmMessage && <p className="text-sm text-[var(--ink-soft)]">{confirmMessage}</p>}

      <div className="space-y-3">
        {leads.map((lead) => {
          const isOpen = expanded === lead.leadId;
          const to = currentTo(lead);
          const activeSequence = openSequence[lead.leadId] ?? 1;
          const activeDraft = lead.drafts.find((d) => d.sequence === activeSequence);
          const activeEdit = activeDraft ? currentDraft(activeDraft) : null;

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

                  {isDraftStatus && (
                    <div className="space-y-1.5 rounded-xl border border-[var(--border)] p-3">
                      <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                        {lead.drafts.length > 0 ? "Rewrite (cold email + both follow-ups)" : "Write emails for just this lead"}
                      </label>
                      <p className="text-xs text-[var(--ink-soft)]">
                        {lead.drafts.length > 0
                          ? "Regenerates all 3 emails using your Settings email instructions and this lead's business summary, plus any feedback you add below."
                          : "Drafts all 3 emails using your Settings email instructions and this lead's business summary — same as the bulk button above, just for this one lead."}
                      </p>
                      <textarea
                        value={rewriteFeedback[lead.leadId] ?? ""}
                        onChange={(e) =>
                          setRewriteFeedback((prev) => ({ ...prev, [lead.leadId]: e.target.value }))
                        }
                        placeholder={`Optional feedback, e.g. "shorter", "don't mention automation", "more casual tone"…`}
                        rows={2}
                        className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRewrite(lead)}
                        disabled={rewriting === lead.leadId}
                        className={btnSecondary}
                      >
                        {rewriting === lead.leadId
                          ? "Writing…"
                          : lead.drafts.length > 0
                            ? "Rewrite"
                            : "Write"}
                      </button>
                      {rewriteMessage[lead.leadId] && (
                        <p className="text-sm text-[var(--ink-soft)]">{rewriteMessage[lead.leadId]}</p>
                      )}
                    </div>
                  )}

                  {lead.drafts.length === 0 ? (
                    <p className="text-sm text-[var(--ink-soft)]">
                      No emails drafted yet for this lead.
                    </p>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        {lead.drafts.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setOpenSequence((prev) => ({ ...prev, [lead.leadId]: d.sequence }))}
                            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                              activeSequence === d.sequence
                                ? "bg-[var(--brand)] text-white"
                                : "border border-[var(--border)] text-[var(--ink-soft)] hover:bg-neutral-50"
                            }`}
                          >
                            {SEQUENCE_LABEL[d.sequence] ?? `Sequence ${d.sequence}`}
                          </button>
                        ))}
                      </div>

                      {activeDraft && activeEdit && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                          Subject
                        </label>
                        <input
                          value={activeEdit.subject}
                          disabled={!isDraftStatus}
                          onChange={(e) =>
                            setDraftEdits((prev) => ({
                              ...prev,
                              [activeDraft.id]: { ...activeEdit, subject: e.target.value },
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
                          onChange={(e) =>
                            setDraftEdits((prev) => ({
                              ...prev,
                              [activeDraft.id]: { ...activeEdit, body: e.target.value },
                            }))
                          }
                          rows={8}
                          className="w-full rounded-xl border border-[var(--border)] px-3.5 py-2.5 font-mono text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)] disabled:bg-neutral-50"
                        />
                      </div>
                    </>
                  )}
                    </>
                  )}

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
