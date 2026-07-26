import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { pickAccountAndSend, pickAccountAndSendPinned } from "@/lib/gmail/sendQueue";
import { nextBusinessSlot } from "@/lib/businessHours";
import type { Settings } from "@/generated/prisma/client";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Dispatches everything due (EmailSend rows with status "scheduled" and
 * scheduledFor <= now), oldest first, strictly sequentially so the random
 * 0-180s pause between sends is honored across the whole queue — not just
 * within one lead's sequence. All durable state lives in EmailSend, so a
 * crash/restart just re-runs this and picks up whatever's still due.
 */
export async function runDueFollowups(): Promise<void> {
  const due = await prisma.emailSend.findMany({
    where: { status: "scheduled", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
  });
  const settings = await getSettings();

  for (let i = 0; i < due.length; i++) {
    const send = due[i];

    const lead = await prisma.lead.findUnique({ where: { id: send.leadId } });
    if (lead?.replyStatus === "Yes") {
      await prisma.emailSend.update({
        where: { id: send.id },
        data: { status: "skipped_reply" },
      });
      await logJobRun("followup", send.id, "success", "skipped: lead already replied");
      continue;
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
      continue;
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

    const isLast = i === due.length - 1;
    if (!isLast) {
      await sleep(randomPauseMs(settings, send.sequence));
    }
  }
}

async function scheduleNextFollowup(leadId: string, justSentSequence: number) {
  if (justSentSequence >= 3) return;

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
  const settings = await getSettings();
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
