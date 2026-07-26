"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { card } from "@/lib/ui";

interface StatsData {
  today: { total: number; byAccount: { email: string; count: number }[] };
  history: Record<string, string | number>[];
  accountEmails: string[];
}

// Brand teal/green first, then a small complementary set for additional accounts.
const BAR_COLORS = ["#0b996e", "#0b3d91", "#d97706", "#7c3aed", "#dc2626", "#0891b2"];

export function StatsView() {
  const [range, setRange] = useState(14);
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats?range=${range}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div className="space-y-6">
      <div className={card}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
          Sent Today
        </h2>
        {loading || !data ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Loading…</p>
        ) : (
          <>
            <p className="mt-1 text-3xl font-semibold text-[var(--ink)]">{data.today.total}</p>
            {data.today.byAccount.length > 0 && (
              <div className="mt-4 space-y-2">
                {data.today.byAccount.map((a) => (
                  <div key={a.email} className="flex items-center justify-between text-sm">
                    <span className="text-[var(--ink-soft)]">{a.email}</span>
                    <span className="font-medium text-[var(--ink)]">{a.count}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
            Send History
          </h2>
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm outline-none focus:border-[var(--brand)]"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>

        {loading || !data ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Loading…</p>
        ) : data.accountEmails.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            No Gmail accounts connected yet — connect one in Settings to start sending.
          </p>
        ) : (
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ec" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "#4a5568" }}
                  axisLine={{ stroke: "#e6e9ec" }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "#4a5568" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid #e6e9ec", fontSize: 13 }}
                />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                {data.accountEmails.map((email, i) => (
                  <Bar
                    key={email}
                    dataKey={email}
                    stackId="sends"
                    fill={BAR_COLORS[i % BAR_COLORS.length]}
                    radius={i === data.accountEmails.length - 1 ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
