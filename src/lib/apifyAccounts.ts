import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import type { ApifyAccount } from "@/generated/prisma/client";

export interface DecryptedApifyAccount {
  id: string;
  token: string;
  label: string | null;
  leadsScraped: number;
  monthlyLimit: number;
}

function decryptAccount(row: ApifyAccount): DecryptedApifyAccount {
  return {
    id: row.id,
    token: decrypt(row.token),
    label: row.label,
    leadsScraped: row.leadsScraped,
    monthlyLimit: row.monthlyLimit,
  };
}

export async function createApifyAccount(token: string, label?: string): Promise<void> {
  await prisma.apifyAccount.create({
    data: { token: encrypt(token), label: label || null },
  });
}

export async function listApifyAccounts() {
  return prisma.apifyAccount.findMany({ orderBy: { createdAt: "asc" } });
}

export async function deleteApifyAccount(id: string): Promise<void> {
  await prisma.apifyAccount.delete({ where: { id } });
}

export async function updateApifyAccount(
  id: string,
  data: { label?: string | null; monthlyLimit?: number; isActive?: boolean }
): Promise<void> {
  await prisma.apifyAccount.update({ where: { id }, data });
}

/**
 * Accounts with remaining capacity, oldest first — scraping drains one
 * account sequentially before moving to the next, rather than balancing
 * evenly across all of them, matching "use account 1 until it's used up,
 * then move to account 2."
 */
export async function getAvailableApifyAccounts(
  excludeIds: Set<string> = new Set()
): Promise<DecryptedApifyAccount[]> {
  const rows = await prisma.apifyAccount.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((r) => !excludeIds.has(r.id) && r.leadsScraped < r.monthlyLimit)
    .map(decryptAccount);
}

/** Fetches one specific account's decrypted token — used to resume checking an in-flight Apify run whose owning account was persisted on the CampaignRun row. */
export async function getApifyAccountById(accountId: string): Promise<DecryptedApifyAccount | null> {
  const row = await prisma.apifyAccount.findUnique({ where: { id: accountId } });
  return row ? decryptAccount(row) : null;
}

export async function incrementLeadsScraped(accountId: string, count: number): Promise<void> {
  if (count <= 0) return;
  await prisma.apifyAccount.update({
    where: { id: accountId },
    data: { leadsScraped: { increment: count } },
  });
}

/** Durably marks an account exhausted (confirmed by a real quota error) so future runs don't keep retrying it until it's manually reactivated. */
export async function deactivateApifyAccount(accountId: string): Promise<void> {
  await prisma.apifyAccount.update({ where: { id: accountId }, data: { isActive: false } });
}

const QUOTA_ERROR_KEYWORDS = [
  "quota",
  "limit exceeded",
  "monthly usage",
  "usage limit",
  "insufficient",
  "exceeded your",
  "rate limit",
  "not enough credit",
];

/** Heuristic: does this error look like an Apify plan/quota exhaustion rather than a transient/network failure? Only errors matching this trigger account rotation — anything else is treated as a normal transient failure (handled by the existing per-tile/location retry-skip logic) so a rotation isn't wasted on an unrelated blip. */
export function looksLikeQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return QUOTA_ERROR_KEYWORDS.some((kw) => message.includes(kw));
}
