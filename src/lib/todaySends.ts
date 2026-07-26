import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";
import { scoreEmailContent } from "@/lib/spamCheck";
import type { TodaySendItem } from "@/components/TodaySendingView";

export const BUCKET_SEQUENCE: Record<string, number> = {
  first: 1,
  followup1: 2,
  followup2: 3,
};

export async function getTodaySends(bucket: string): Promise<TodaySendItem[]> {
  const sequence = BUCKET_SEQUENCE[bucket];
  if (!sequence) return [];

  const now = new Date();
  const sends = await prisma.emailSend.findMany({
    where: {
      sequence,
      // "ready" (drafted via Write Emails + Upload, not yet released for
      // sending) always shows regardless of date — it has nothing
      // meaningful to "be due" until you explicitly release it. Everything
      // else (scheduled/sent/failed/cancelled) is scoped to today.
      OR: [
        { status: "ready" },
        { scheduledFor: { gte: startOfDay(now), lte: endOfDay(now) } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    include: {
      lead: {
        select: {
          id: true,
          businessName: true,
          primaryEmail: true,
          aboutSummary: true,
          bounced: true,
          emailVerificationStatus: true,
          followup2ScheduledFor: true,
          followup3ScheduledFor: true,
        },
      },
      emailDraft: { select: { id: true, subject: true, body: true } },
      senderAccount: { select: { emailAddress: true } },
    },
  });

  // Self-heal: a lead can go bad (bounced, or edited into an invalid
  // address) after its send was queued but before the next scheduler tick
  // catches up. Never show — or leave sitting as "scheduled" — a send for
  // a lead that's currently unsendable; cancel it here so the list only
  // ever shows sends that could actually go out.
  const stillGood = [];
  for (const s of sends) {
    const isBad = s.lead.bounced || s.lead.emailVerificationStatus === "invalid";
    if (isBad && (s.status === "scheduled" || s.status === "ready")) {
      await prisma.emailSend.update({ where: { id: s.id }, data: { status: "cancelled" } });
      continue;
    }
    if (isBad) continue; // already sent/failed/cancelled — keep out of the active list either way
    stillGood.push(s);
  }

  return stillGood.map((s) => ({
    sendId: s.id,
    leadId: s.lead.id,
    businessName: s.lead.businessName,
    primaryEmail: s.lead.primaryEmail,
    aboutSummary: s.lead.aboutSummary !== "null" ? s.lead.aboutSummary : null,
    sequence: s.sequence,
    status: s.status,
    scheduledFor: s.scheduledFor.toISOString(),
    sentAt: s.sentAt ? s.sentAt.toISOString() : null,
    senderEmail: s.senderAccount?.emailAddress ?? null,
    sentManually: s.sentManually,
    followup2ScheduledFor: s.lead.followup2ScheduledFor?.toISOString() ?? null,
    followup3ScheduledFor: s.lead.followup3ScheduledFor?.toISOString() ?? null,
    draft: { id: s.emailDraft.id, subject: s.emailDraft.subject, body: s.emailDraft.body },
    liveSpamScore: scoreEmailContent(s.emailDraft.subject, s.emailDraft.body),
  }));
}
