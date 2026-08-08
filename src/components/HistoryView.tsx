"use client";

import { useEffect, useState } from "react";
import { card, badgeClass } from "@/lib/ui";

interface HistoryRow {
  id: string;
  businessName: string;
  recipient: string;
  sequence: number;
  subject: string;
  senderEmail: string | null;
  status: string;
  sentAt: string | null;
  scheduledFor: string;
  errorMessage: string | null;
}

const SEQUENCE_LABEL: Record<number, string> = { 1: "Cold email", 2: "Follow-up 1", 3: "Follow-up 2" };

function formatExact(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function HistoryView() {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/history?page=${page}`)
      .then((r) => r.json())
      .then((data) => {
        setRows(data.sends ?? []);
        setTotal(data.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className={card}>
        {loading || !rows ? (
          <p className="text-sm text-[var(--ink-soft)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">No sends yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                <tr>
                  <th className="py-2 pr-4">Date &amp; Time</th>
                  <th className="py-2 pr-4">Business</th>
                  <th className="py-2 pr-4">Recipient</th>
                  <th className="py-2 pr-4">Sequence</th>
                  <th className="py-2 pr-4">Sender</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-[var(--ink)]">
                      {formatExact(r.sentAt ?? r.scheduledFor)}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--ink)]">{r.businessName}</td>
                    <td className="py-2.5 pr-4 text-[var(--ink-soft)]">{r.recipient}</td>
                    <td className="py-2.5 pr-4 text-[var(--ink-soft)]">
                      {SEQUENCE_LABEL[r.sequence] ?? `Sequence ${r.sequence}`}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--ink-soft)]">{r.senderEmail ?? "—"}</td>
                    <td className="py-2.5 pr-4">
                      <span className={badgeClass(r.status === "sent" ? "green" : "red")} title={r.errorMessage ?? undefined}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-[var(--ink-soft)]">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages} · {total} total sends
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
