import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { ensureFreshAccessToken } from "@/lib/gmail/oauth";
import { sendPlainEmail } from "@/lib/gmail/client";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { scoreEmailContent, refreshSenderSpamScore } from "@/lib/spamCheck";
import { format } from "date-fns";
import type { EmailSend, SenderAccount, Settings } from "@/generated/prisma/client";

function todayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export type SendOutcome =
  | { status: "sent"; senderEmail: string; gmailMessageId: string; gmailThreadId: string }
  | { status: "deferred"; reason: string }
  | { status: "failed"; error: string };

type SendWithRelations = EmailSend & {
  emailDraft: { subject: string; body: string };
  lead: { primaryEmail: string; id: string; emailVerificationStatus: string; bounced: boolean };
};

/**
 * Last line of defense against sending to a known-bad address, even if a
 * caller bypasses the "Qualified Only" UI filter — checked at dispatch
 * time, not just at draft time, since verification/bounce status can
 * change between when a send was queued and when it's actually dispatched.
 */
function deliverabilityBlockReason(lead: SendWithRelations["lead"]): string | null {
  if (lead.bounced) return "lead's email previously bounced";
  if (lead.emailVerificationStatus === "invalid") return "lead's email failed deliverability check";
  return null;
}

/**
 * Blocks sending if this exact email address already has a successful send
 * under a DIFFERENT lead — protects against the same business getting
 * scraped into two separate Lead rows (different runs, slightly different
 * name/address) and emailed twice. A lead's own prior sends never block it.
 */
async function findDuplicateBlockReason(send: SendWithRelations): Promise<string | null> {
  if (!send.lead.primaryEmail || send.lead.primaryEmail === "null") return null;
  const dup = await prisma.emailSend.findFirst({
    where: {
      status: "sent",
      lead: { primaryEmail: send.lead.primaryEmail },
      leadId: { not: send.lead.id },
    },
    select: { id: true },
  });
  return dup ? "this email was already sent to via a different lead (duplicate)" : null;
}

/** Per-sequence-stage cap for an account: its own override, falling back to the matching Settings default. */
function capForSequence(settings: Settings, account: SenderAccount, sequence: number): number {
  if (sequence === 1) return account.dailyCapCold ?? settings.dailyCapCold;
  if (sequence === 2) return account.dailyCapFollowup2 ?? settings.dailyCapFollowup2;
  return account.dailyCapFollowup3 ?? settings.dailyCapFollowup3;
}

async function usedCountForSequence(senderAccountId: string, date: string, sequence: number): Promise<number> {
  const counter = await prisma.dailySendCounter.findUnique({
    where: { senderAccountId_date_sequence: { senderAccountId, date, sequence } },
  });
  return counter?.count ?? 0;
}

/**
 * Sends through a specific, already-decided account (either eagerly
 * assigned at sending-campaign creation, or pinned from a prior sequence's
 * sent record) — checks that account is active and under ITS cap for this
 * send's sequence stage, defers if not, and never substitutes a different
 * account. This is the single place both entry points below funnel into
 * once an account has been decided, so the cap/active checks can't drift
 * between the two paths.
 */
async function sendUsingAccount(
  send: SendWithRelations,
  accountId: string,
  settings: Settings,
  today: string
): Promise<SendOutcome> {
  const account = await prisma.senderAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) {
    return { status: "deferred", reason: "assigned sender account is no longer active" };
  }
  const used = await usedCountForSequence(account.id, today, send.sequence);
  const cap = capForSequence(settings, account, send.sequence);
  if (used >= cap) {
    return {
      status: "deferred",
      reason: `assigned sender account is at its daily cap for sequence ${send.sequence}`,
    };
  }
  return performSend(send, account, settings, today);
}

/**
 * Runs the spam gate, sends via the chosen account, and records the
 * outcome (including the spam-check snapshot) — shared by every selection
 * path above.
 */
async function performSend(
  send: SendWithRelations,
  chosen: SenderAccount,
  settings: Settings,
  today: string
): Promise<SendOutcome> {
  const spamResult = scoreEmailContent(send.emailDraft.subject, send.emailDraft.body);
  const spamCheckFlags = JSON.stringify(spamResult.flags);

  if (spamResult.score >= settings.spamScoreThreshold && settings.spamScoreAction === "block") {
    await prisma.emailSend.update({
      where: { id: send.id },
      data: {
        status: "failed",
        errorMessage: `blocked by spam check (score ${spamResult.score}): ${
          spamResult.flags.join(", ") || "no specific flags"
        }`,
        spamCheckScore: spamResult.score,
        spamCheckFlags,
      },
    });
    await refreshSenderSpamScore(chosen.id).catch(() => {});
    return { status: "failed", error: `blocked by spam check (score ${spamResult.score})` };
  }

  try {
    const accessToken = await ensureFreshAccessToken(chosen);

    let inReplyToMessageId: string | undefined;
    let threadId: string | undefined;
    if (send.sequence > 1) {
      const priorSend = await prisma.emailSend.findFirst({
        where: { leadId: send.leadId, sequence: send.sequence - 1, status: "sent" },
      });
      inReplyToMessageId = priorSend?.gmailMessageId ?? undefined;
      threadId = priorSend?.gmailThreadId ?? undefined;
    }

    const result = await sendPlainEmail({
      accessToken,
      from: chosen.emailAddress,
      to: send.lead.primaryEmail,
      subject: send.emailDraft.subject,
      body: send.emailDraft.body,
      inReplyToMessageId,
      threadId,
    });

    await recordSuccessfulSend(
      send,
      chosen.id,
      chosen.emailAddress,
      result,
      today,
      spamResult.score,
      spamCheckFlags
    );
    await refreshSenderSpamScore(chosen.id).catch(() => {});

    return {
      status: "sent",
      senderEmail: chosen.emailAddress,
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gmail send failed";
    await prisma.emailSend.update({
      where: { id: send.id },
      data: {
        status: "failed",
        errorMessage: message,
        spamCheckScore: spamResult.score,
        spamCheckFlags,
      },
    });
    await refreshSenderSpamScore(chosen.id).catch(() => {});
    return { status: "failed", error: message };
  }
}

/**
 * Sequence-1 (and manual "Send Now") entry point. If the send already has a
 * senderAccountId (eagerly assigned at sending-campaign creation), honors
 * that assignment — active + under-cap check only, never reassigns. Only
 * falls back to picking the least-used eligible account when no account was
 * pre-assigned (legacy/ad-hoc sends).
 */
export async function pickAccountAndSend(sendId: string): Promise<SendOutcome> {
  const send = await prisma.emailSend.findUnique({
    where: { id: sendId },
    include: { emailDraft: true, lead: true },
  });
  if (!send) return { status: "failed", error: "EmailSend not found" };
  if (send.status !== "scheduled") {
    return { status: "failed", error: `EmailSend is not in "scheduled" state (${send.status})` };
  }
  const blockReason = deliverabilityBlockReason(send.lead) ?? (await findDuplicateBlockReason(send));
  if (blockReason) {
    await prisma.emailSend.update({
      where: { id: send.id },
      data: { status: "failed", errorMessage: blockReason },
    });
    return { status: "failed", error: blockReason };
  }

  const settings = await getSettings();
  const today = todayKey();

  const globalSentToday = await prisma.dailySendCounter.aggregate({
    where: { date: today },
    _sum: { count: true },
  });
  if ((globalSentToday._sum.count ?? 0) >= settings.globalSendLimit) {
    return { status: "deferred", reason: "global daily send limit reached" };
  }

  if (send.senderAccountId) {
    return sendUsingAccount(send, send.senderAccountId, settings, today);
  }

  const accounts = await prisma.senderAccount.findMany({ where: { isActive: true } });
  if (accounts.length === 0) {
    return { status: "deferred", reason: "no active sender accounts configured" };
  }

  const withCounts = await Promise.all(
    accounts.map(async (account) => ({
      account,
      used: await usedCountForSequence(account.id, today, send.sequence),
      cap: capForSequence(settings, account, send.sequence),
    }))
  );

  const eligible = withCounts.filter((x) => x.used < x.cap).sort((a, b) => a.used - b.used);
  if (eligible.length === 0) {
    return { status: "deferred", reason: "all sender accounts are at their daily cap" };
  }

  return performSend(send, eligible[0].account, settings, today);
}

/**
 * Sends a follow-up (sequence 2/3) ONLY through a fixed sender account —
 * switching senders mid-thread would break Gmail thread continuity and look
 * suspicious to the recipient. Prefers the send's own pre-assigned
 * senderAccountId (eager assignment, propagated forward when this row was
 * created); falls back to looking up the lead's sequence-1 sent account for
 * any row created before eager assignment existed. If that account is now
 * inactive or over its cap, the send is deferred (left "scheduled") rather
 * than falling back to a different account, and retried on a later tick.
 */
export async function pickAccountAndSendPinned(sendId: string): Promise<SendOutcome> {
  const send = await prisma.emailSend.findUnique({
    where: { id: sendId },
    include: { emailDraft: true, lead: true },
  });
  if (!send) return { status: "failed", error: "EmailSend not found" };
  if (send.status !== "scheduled") {
    return { status: "failed", error: `EmailSend is not in "scheduled" state (${send.status})` };
  }
  const blockReason = deliverabilityBlockReason(send.lead) ?? (await findDuplicateBlockReason(send));
  if (blockReason) {
    await prisma.emailSend.update({
      where: { id: send.id },
      data: { status: "failed", errorMessage: blockReason },
    });
    return { status: "failed", error: blockReason };
  }

  const settings = await getSettings();
  const today = todayKey();

  const globalSentToday = await prisma.dailySendCounter.aggregate({
    where: { date: today },
    _sum: { count: true },
  });
  if ((globalSentToday._sum.count ?? 0) >= settings.globalSendLimit) {
    return { status: "deferred", reason: "global daily send limit reached" };
  }

  if (send.senderAccountId) {
    return sendUsingAccount(send, send.senderAccountId, settings, today);
  }

  const priorSend = await prisma.emailSend.findFirst({
    where: { leadId: send.leadId, sequence: send.sequence - 1, status: "sent" },
  });
  if (!priorSend?.senderAccountId) {
    // Shouldn't normally happen (a follow-up implies sequence 1 already sent),
    // but fall back to normal least-used selection rather than getting stuck.
    return pickAccountAndSend(sendId);
  }

  return sendUsingAccount(send, priorSend.senderAccountId, settings, today);
}

async function recordSuccessfulSend(
  send: EmailSend,
  senderAccountId: string,
  senderEmail: string,
  result: { messageId: string; threadId: string },
  today: string,
  spamCheckScore: number,
  spamCheckFlags: string
) {
  await prisma.$transaction([
    prisma.emailSend.update({
      where: { id: send.id },
      data: {
        status: "sent",
        sentAt: new Date(),
        senderAccountId,
        gmailMessageId: result.messageId,
        gmailThreadId: result.threadId,
        spamCheckScore,
        spamCheckFlags,
      },
    }),
    prisma.dailySendCounter.upsert({
      where: { senderAccountId_date_sequence: { senderAccountId, date: today, sequence: send.sequence } },
      update: { count: { increment: 1 } },
      create: { senderAccountId, date: today, sequence: send.sequence, count: 1 },
    }),
  ]);
  await syncLeadToSheet(send.leadId, senderEmail);
}
