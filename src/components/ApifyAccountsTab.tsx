"use client";

import { useEffect, useState } from "react";
import { btnPrimary, btnGhost, badgeClass, input as inputClass } from "@/lib/ui";

interface ApifyAccountRow {
  id: string;
  label: string | null;
  leadsScraped: number;
  monthlyLimit: number;
  isActive: boolean;
}

export function ApifyAccountsTab() {
  const [accounts, setAccounts] = useState<ApifyAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/apify-accounts");
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd() {
    if (!newToken.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/apify-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: newToken.trim(), label: newLabel.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add account");
      setNewToken("");
      setNewLabel("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add account");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleActive(account: ApifyAccountRow) {
    await fetch(`/api/apify-accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !account.isActive }),
    });
    await load();
  }

  async function handleLimitChange(account: ApifyAccountRow, monthlyLimit: number) {
    await fetch(`/api/apify-accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyLimit }),
    });
    await load();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/apify-accounts/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ink-soft)]">
        Multiple Apify accounts let scraping rotate to the next one once the current one is used
        up — either it crosses its own configured lead limit, or Apify returns a real quota error
        (which also deactivates it here, since it's confirmed exhausted).
      </p>

      {loading ? (
        <p className="text-sm text-[var(--ink-soft)]">Loading…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)]">No Apify accounts added yet.</p>
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="flex-1">
                <p className="text-base font-medium text-[var(--ink)]">
                  {account.label || "Untitled account"}
                </p>
                <div className="mt-1 flex items-center gap-3">
                  <p className="text-sm text-[var(--ink-soft)]">
                    {account.leadsScraped} leads scraped of
                  </p>
                  <input
                    type="number"
                    min={1}
                    value={account.monthlyLimit}
                    onChange={(e) => handleLimitChange(account, Number(e.target.value))}
                    className={`${inputClass} w-24 py-1`}
                  />
                  {!account.isActive && <span className={badgeClass("red")}>inactive</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggleActive(account)} className={btnGhost}>
                  {account.isActive ? "Deactivate" : "Reactivate"}
                </button>
                <button
                  onClick={() => handleDelete(account.id)}
                  className="text-base font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-[var(--border)] p-4">
        <p className="text-sm font-medium text-[var(--ink)]">Add an Apify account</p>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={'Label (optional, e.g. "Account 2")'}
          className={inputClass}
        />
        <input
          value={newToken}
          onChange={(e) => setNewToken(e.target.value)}
          placeholder="Apify API token"
          type="password"
          className={inputClass}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={handleAdd} disabled={adding || !newToken.trim()} className={btnPrimary}>
          {adding ? "Adding…" : "Add Account"}
        </button>
      </div>
    </div>
  );
}
