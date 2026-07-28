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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className={card}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}

export function SummaryView() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/summary")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

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
        <StatTile label="Replies" value={data.replyCount} />
      </div>

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
