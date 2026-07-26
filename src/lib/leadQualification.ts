import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { LEAD_FILTER_MIN_FIT_SCORE } from "@/lib/constants";

/**
 * Shared Step-3 qualification filter: has a discovered email that passed
 * the local MX/syntax check (or hasn't been re-checked yet), hasn't
 * bounced, and meets the minimum fit score. Used both by the run page's
 * "Qualified Only" toggle and the batch write-and-upload route so the two
 * can never drift — a lead flagged invalid/bounced never gets drafted or
 * sent to again, regardless of email presence or fit score.
 *
 * Does NOT cover duplicate-email detection — that can't be expressed as a
 * static where clause (it depends on what's already been sent elsewhere in
 * the DB), so use getDuplicateEmailLeadIds()/filterOutDuplicateEmails()
 * alongside this for the full qualification check.
 */
export const QUALIFIED_LEAD_WHERE: Prisma.LeadWhereInput = {
  primaryEmail: { not: "null" },
  AND: [{ primaryEmail: { not: "" } }],
  fitScore: { gte: LEAD_FILTER_MIN_FIT_SCORE },
  emailVerificationStatus: { not: "invalid" },
  bounced: false,
};

/**
 * In-memory mirror of QUALIFIED_LEAD_WHERE for callers that already have the
 * row in hand (e.g. right after an update) and don't want a second query.
 * Keep this in lockstep with QUALIFIED_LEAD_WHERE above.
 */
export function isLeadQualified(lead: {
  primaryEmail: string;
  fitScore: number;
  emailVerificationStatus: string;
  bounced: boolean;
}): boolean {
  return (
    lead.primaryEmail !== "null" &&
    lead.primaryEmail !== "" &&
    lead.fitScore >= LEAD_FILTER_MIN_FIT_SCORE &&
    lead.emailVerificationStatus !== "invalid" &&
    !lead.bounced
  );
}

/**
 * Finds leads whose email address already has a successful send under a
 * DIFFERENT lead — i.e. the same real business/inbox got scraped into two
 * separate Lead rows (different runs, slightly different name/address) and
 * one of them already got emailed. A lead is never blocked by its own past
 * sends, only by another lead's.
 */
export async function getDuplicateEmailLeadIds(
  candidateLeads: { id: string; primaryEmail: string }[]
): Promise<Set<string>> {
  const relevantEmails = [
    ...new Set(candidateLeads.map((l) => l.primaryEmail).filter((e) => e && e !== "null")),
  ];
  if (relevantEmails.length === 0) return new Set();

  const sentSends = await prisma.emailSend.findMany({
    where: { status: "sent", lead: { primaryEmail: { in: relevantEmails } } },
    distinct: ["leadId"],
    select: { leadId: true, lead: { select: { primaryEmail: true } } },
  });

  const emailToSenderLeadIds = new Map<string, Set<string>>();
  for (const s of sentSends) {
    const email = s.lead.primaryEmail;
    if (!emailToSenderLeadIds.has(email)) emailToSenderLeadIds.set(email, new Set());
    emailToSenderLeadIds.get(email)!.add(s.leadId);
  }

  const blocked = new Set<string>();
  for (const lead of candidateLeads) {
    const senders = emailToSenderLeadIds.get(lead.primaryEmail);
    if (senders && [...senders].some((id) => id !== lead.id)) {
      blocked.add(lead.id);
    }
  }
  return blocked;
}

export async function filterOutDuplicateEmails<T extends { id: string; primaryEmail: string }>(
  leads: T[]
): Promise<T[]> {
  const blocked = await getDuplicateEmailLeadIds(leads);
  return leads.filter((l) => !blocked.has(l.id));
}

/**
 * Immediately cancels any still-pending (status "scheduled") sends for a
 * lead the moment it becomes un-sendable — bounced, failed the
 * deliverability check, etc. Called right where that state changes rather
 * than waiting for the next scheduler tick, so a bad lead can never sit in
 * Today's Sending / Follow-ups looking ready to go out.
 */
export async function cancelScheduledSendsForLead(leadId: string): Promise<void> {
  await prisma.emailSend.updateMany({
    where: { leadId, status: "scheduled" },
    data: { status: "cancelled" },
  });
}
