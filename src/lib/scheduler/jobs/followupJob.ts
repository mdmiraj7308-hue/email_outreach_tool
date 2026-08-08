import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { pickAccountAndSend, pickAccountAndSendPinned } from "@/lib/gmail/sendQueue";
import { nextBusinessSlot } from "@/lib/businessHours";
import type { Settings } from "@/generated/prisma/client";

// Sequence-1 sends use a wider pause range than follow-ups, both configurable
// in Settings (defaults: 5-120s first email, 5-100s follow-ups).
function randomPauseMs(settings: Settings, sequence: number): number {
  const [min, max] =
    sequence === 1
      ? [settings.firstSendPauseMinSeconds, settings.firstSendPauseMaxSeconds]
      : [settings.followupPauseMinSeconds, settings.followupPauseMaxSeconds];
  const seconds = min + Math.random() * Math.max(0, max - min);
  return Math.round(seconds * 1000);
}

/**
 * Dispatches at most ONE due EmailSend (status "scheduled", scheduledFor <=
 * now, oldest first) per call, gated by Settings.nextFollowupDispatchAt so
 * consecutive sends are still spaced by the randomized pause — across the
 * whole queue, not just within one lead's sequence, same as before.
 *
 * This used to send everything due in one loop with `await sleep(60-500s)`
 * between each. That relied on the process staying alive for the full pause,
 * which doesn't hold on Vercel: `/api/cron/tick` is a fresh serverless
 * invocation every time cron-job.org hits it (~once/minute), and Vercel
 * kills any invocation that runs long before a 60-500s sleep could ever
 * finish. In production this meant only the first send of a batch actually
 * went out from the pause logic — every send after it was really just
 * whatever the next cron tick happened to pick up, spaced by the external
 * cron interval instead of the configured random range.
 *
 * Persisting the "not before" timestamp instead means each tick either
 * finds it's too soon and does nothing, or finds it's clear and sends
 * exactly one thing — no in-process waiting required, so nothing can be
 * killed mid-pause. The tradeoff: real-world spacing can't be finer than
 * the external cron interval even if the random pause rolls shorter.
 */
export async function runDueFollowups(): Promise<void> {
  const settings = await getSettings();
  if (settings.nextFollowupDispatchAt && settings.nextFollowupDispatchAt.getTime() > Date.now()) {
    return; // still cooling down from the last dispatch — try again next tick
  }

  const send = await prisma.emailSend.findFirst({
    where: { status: "scheduled", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
  });
  if (!send) return;

  const lead = await prisma.lead.findUnique({ where: { id: send.leadId } });
  if (lead?.replyStatus === "Yes") {
    await prisma.emailSend.update({
      where: { id: send.id },
      data: { status: "skipped_reply" },
    });
    await logJobRun("followup", send.id, "success", "skipped: lead already replied");
    return; // not a real send attempt — doesn't consume a pause slot
  }

  let outcome;
  try {
    outcome = send.sequence > 1
      ? await pickAccountAndSendPinned(send.id)
      : await pickAccountAndSend(send.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unexpected error";
    console.error(`[followupJob] send ${send.id} threw unexpectedly`, err);
    await prisma.emailSend
      .update({ where: { id: send.id }, data: { status: "failed", errorMessage: message } })
      .catch(() => {});
    await logJobRun("followup", send.id, "failed", message);
    await armNextDispatchGate(settings, send.sequence);
    return;
  }

  if (outcome.status === "sent") {
    await logJobRun("followup", send.id, "success", `sent via ${outcome.senderEmail}`);
    await scheduleNextFollowup(send.leadId, send.sequence);
  } else if (outcome.status === "deferred") {
    await logJobRun("followup", send.id, "success", `deferred: ${outcome.reason}`);
    // Left as "scheduled" — will be retried on a later tick once caps free up.
  } else {
    await logJobRun("followup", send.id, "failed", outcome.error);
  }

  await armNextDispatchGate(settings, send.sequence);
}

async function armNextDispatchGate(settings: Settings, sequence: number): Promise<void> {
  await prisma.settings.update({
    where: { id: 1 },
    data: { nextFollowupDispatchAt: new Date(Date.now() + randomPauseMs(settings, sequence)) },
  });
}

async function scheduleNextFollowup(leadId: string, justSentSequence: number) {
  if (justSentSequence >= 3) return;

  const settings = await getSettings();
  // followup2Enabled never matters on its own — follow-up 2 (sequence 3)
  // only ever fires after follow-up 1 (sequence 2) actually sends, so if
  // that's off, sequence 3 is naturally never reached anyway.
  if (justSentSequence === 1 && !settings.followupEnabled) return;
  if (justSentSequence === 2 && !settings.followup2Enabled) return;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.replyStatus === "Yes") return;

  const nextSequence = justSentSequence + 1;
  const nextDraft = await prisma.emailDraft.findUnique({
    where: { leadId_sequence: { leadId, sequence: nextSequence } },
  });
  if (!nextDraft) return; // no draft written for the next step — nothing to schedule

  const existing = await prisma.emailSend.findUnique({
    where: { emailDraftId: nextDraft.id },
  });
  if (existing) return; // already scheduled/sent — don't double-schedule

  // A manually-set date on the lead (any specific time, not just "N days
  // after") wins over the default Settings-based spacing when present —
  // and is never bumped into business hours, since the user chose that
  // exact moment on purpose.
  const customScheduledFor =
    nextSequence === 2 ? lead.followup2ScheduledFor : lead.followup3ScheduledFor;

  let scheduledFor: Date;
  if (customScheduledFor) {
    scheduledFor = customScheduledFor;
  } else {
    const spacingDays =
      justSentSequence === 1
        ? settings.followupSpacingDays
        : (settings.followup2SpacingDays ?? settings.followupSpacingDays);
    const candidate = new Date(Date.now() + spacingDays * 24 * 60 * 60 * 1000);
    scheduledFor = nextBusinessSlot(
      candidate,
      settings.businessHoursStartHour,
      settings.businessHoursEndHour,
      settings.businessHoursTimezone
    );
  }

  // Propagate the sender that just sent sequence `justSentSequence` forward
  // onto this next row too, so pickAccountAndSendPinned's cheaper direct
  // check (send.senderAccountId already set) is the common path — it still
  // falls back to looking this up itself if this is ever null.
  const justSent = await prisma.emailSend.findFirst({
    where: { leadId, sequence: justSentSequence, status: "sent" },
    select: { senderAccountId: true },
  });

  await prisma.emailSend.create({
    data: {
      leadId,
      emailDraftId: nextDraft.id,
      sequence: nextSequence,
      status: "scheduled",
      scheduledFor,
      senderAccountId: justSent?.senderAccountId ?? null,
    },
  });
}

async function logJobRun(
  jobType: string,
  refId: string,
  status: "success" | "failed",
  message: string
) {
  await prisma.jobRun.create({ data: { jobType, refId, status, message } }).catch(() => {});
}
