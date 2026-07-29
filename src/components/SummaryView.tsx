"use client";

import { useEffect, useState } from "react";
import { card, spamScoreBadge } from "@/lib/ui";

interface SummaryData {
  totalLeadsScraped: number;
  qualifiedLeads: number;
  totalSent: number;
  successfulSends: number;
  failedSends: number;
  followup1Sent: number;
  followup2Sent: number;
  replyCount: number;
  perSender: {
    senderAccountId: string;
    emailAddress: string;
    sentCount: number;
    failedCount: number;
    spamScore: number;
  }[];
}

function StatTile({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick) && value > 0;
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`${card} text-left transition ${clickable ? "cursor-pointer hover:border-[var(--brand)]" : "cursor-default"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold text-[var(--ink)]">{value}</p>
    </button>
  );
}

interface ReplyDetail {
  leadId: string;
  businessName: string;
  primaryEmail: string;
  senderEmail: string | null;
  gmailThreadId: string | null;
  sentAt: string | null;
}

export function SummaryView() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [replies, setReplies] = useState<ReplyDetail[] | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [repliesLoading, setRepliesLoading] = useState(false);

  useEffect(() => {
    fetch("/api/summary")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  async function handleRepliesClick() {
    if (repliesOpen) {
      setRepliesOpen(false);
      return;
    }
    setRepliesOpen(true);
    if (replies) return; // already fetched once — no need to re-fetch every toggle
    setRepliesLoading(true);
    try {
      const res = await fetch("/api/summary/replies");
      const json = await res.json();
      setReplies(json.replies ?? []);
    } finally {
      setRepliesLoading(false);
    }
  }

  if (loading || !data) {
    return <p className="text-sm text-[var(--ink-soft)]">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile label="Leads Scraped" value={data.totalLeadsScraped} />
        <StatTile label="Qualified Leads" value={data.qualifiedLeads} />
        <StatTile label="Total Sent" value={data.totalSent} />
        <StatTile label="Successful" value={data.successfulSends} />
        <StatTile label="Failed" value={data.failedSends} />
        <StatTile label="2nd Follow-ups" value={data.followup1Sent} />
        <StatTile label="3rd Follow-ups" value={data.followup2Sent} />
        <StatTile label="Replies" value={data.replyCount} onClick={handleRepliesClick} />
      </div>

      {repliesOpen && (
        <div className={card}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
            Who Replied
          </h2>
          {repliesLoading ? (
            <p className="mt-2 text-sm text-[var(--ink-soft)]">Loading…</p>
          ) : !replies || replies.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--ink-soft)]">No replies yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                  <tr>
                    <th className="py-2 pr-4">Business</th>
                    <th className="py-2 pr-4">Replied From</th>
                    <th className="py-2 pr-4">Received In</th>
                    <th className="py-2 pr-4">Sent At</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {replies.map((r) => (
                    <tr key={r.leadId}>
                      <td className="py-2.5 pr-4 text-[var(--ink)]">
                        <a href={`/leads/${r.leadId}`} className="hover:underline">
                          {r.businessName}
                        </a>
                      </td>
                      <td className="py-2.5 pr-4 text-[var(--ink-soft)]">{r.primaryEmail}</td>
                      <td className="py-2.5 pr-4 text-[var(--ink-soft)]">{r.senderEmail ?? "—"}</td>
                      <td className="py-2.5 pr-4 text-[var(--ink-soft)]">
                        {r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        {r.senderEmail && r.gmailThreadId && (
                          <a
                            href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(r.senderEmail)}#all/${r.gmailThreadId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--brand)] hover:underline"
                          >
                            Open in Gmail
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className={card}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
          Per-Sender Breakdown
        </h2>
        {data.perSender.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            No Gmail accounts connected yet — connect one in Settings to start sending.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                <tr>
                  <th className="py-2 pr-4">Sender</th>
                  <th className="py-2 pr-4">Sent</th>
                  <th className="py-2 pr-4">Failed</th>
                  <th className="py-2 pr-4">Spam Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.perSender.map((s) => {
                  const badge = spamScoreBadge(s.spamScore);
                  return (
                    <tr key={s.senderAccountId}>
                      <td className="py-2.5 pr-4 text-[var(--ink)]">{s.emailAddress}</td>
                      <td className="py-2.5 pr-4 text-[var(--ink-soft)]">{s.sentCount}</td>
                      <td className="py-2.5 pr-4 text-[var(--ink-soft)]">{s.failedCount}</td>
                      <td className="py-2.5 pr-4">
                        <span className={badge.className}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
