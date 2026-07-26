"use client";

import { useEffect, useState } from "react";
import { btnPrimary } from "@/lib/ui";

interface GmailAccount {
  id: string;
  emailAddress: string;
  isActive: boolean;
  dailyCapCold: number;
  dailyCapFollowup2: number;
  dailyCapFollowup3: number;
  sentTodayCold: number;
  sentTodayFollowup2: number;
  sentTodayFollowup3: number;
}

export function GmailAccountsTab() {
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);

  useEffect(() => {
    // Read directly from the URL client-side to avoid the Suspense boundary
    // next/navigation's useSearchParams would otherwise require here.
    const params = new URLSearchParams(window.location.search);
    setConnectedEmail(params.get("gmailConnected"));
    setGmailError(params.get("gmailError"));
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/gmail/accounts");
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDisconnect(id: string) {
    await fetch(`/api/gmail/accounts?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      {connectedEmail && (
        <p className="rounded-xl bg-[var(--brand-light)] px-3.5 py-2.5 text-sm text-[var(--brand-dark)]">
          Connected {connectedEmail}
        </p>
      )}
      {gmailError && (
        <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{gmailError}</p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--ink-soft)]">Loading…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)]">No Gmail accounts connected yet.</p>
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-light)] text-sm font-semibold text-[var(--brand-dark)]">
                  {account.emailAddress.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-base font-medium text-[var(--ink)]">{account.emailAddress}</p>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {account.sentTodayCold}/{account.dailyCapCold} cold ·{" "}
                    {account.sentTodayFollowup2}/{account.dailyCapFollowup2} f/u2 ·{" "}
                    {account.sentTodayFollowup3}/{account.dailyCapFollowup3} f/u3 today
                    {!account.isActive && " · disconnected"}
                  </p>
                </div>
              </div>
              {account.isActive && (
                <button
                  onClick={() => handleDisconnect(account.id)}
                  className="text-base font-medium text-red-600 hover:underline"
                >
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <a href="/api/gmail/oauth/start" className={btnPrimary}>
        Connect Gmail Account
      </a>
    </div>
  );
}
