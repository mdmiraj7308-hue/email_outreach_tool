import { subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { ensureFreshAccessToken } from "@/lib/gmail/oauth";
import { findBounceForRecipient } from "@/lib/gmail/client";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { cancelScheduledSendsForLead } from "@/lib/leadQualification";

const BOUNCE_LOOKBACK_DAYS = 3;

/**
 * For every lead with a recently sent email that hasn't already bounced,
 * checks the sending account's inbox for a delivery-failure notification.
 * If found, hard-stops the lead (same treatment as a reply) so no more
 * follow-ups go to a dead address — this is the safety net behind the
 * free MX/syntax check run at enrichment time, which can't catch a domain
 * that's alive but the specific mailbox is dead.
 */
export async function runBounceChecks(): Promise<void> {
  const since = subDays(new Date(), BOUNCE_LOOKBACK_DAYS);

  const candidates = await prisma.emailSend.findMany({
    where: {
      status: "sent",
      sentAt: { gte: since },
      lead: { bounced: false },
    },
    orderBy: { sentAt: "desc" },
    include: { senderAccount: true, lead: true },
  });

  // Only need the most recent sent send per lead — if that one didn't
  // bounce we don't need to separately re-check earlier sequences.
  const latestPerLead = new Map<string, (typeof candidates)[number]>();
  for (const send of candidates) {
    if (!latestPerLead.has(send.leadId)) {
      latestPerLead.set(send.leadId, send);
    }
  }

  for (const send of latestPerLead.values()) {
    if (!send.senderAccount || !send.sentAt) continue;
    if (!send.lead.primaryEmail || send.lead.primaryEmail === "null") continue;

    try {
      const accessToken = await ensureFreshAccessToken(send.senderAccount);
      const bounced = await findBounceForRecipient(
        accessToken,
        send.lead.primaryEmail,
        send.sentAt.getTime()
      );

      if (bounced) {
        await markLeadBounced(send.leadId, send.id);
      }
    } catch (err) {
      console.error(`[bounceCheckJob] failed to check bounce for lead ${send.leadId}`, err);
      await prisma.jobRun
        .create({
          data: {
            jobType: "bounceCheck",
            refId: send.leadId,
            status: "failed",
            message: err instanceof Error ? err.message : "unexpected error",
          },
        })
        .catch(() => {});
    }
  }
}

async function markLeadBounced(leadId: string, bouncedSendId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { bounced: true, emailVerificationStatus: "invalid" },
  });
  await prisma.emailSend.update({
    where: { id: bouncedSendId },
    data: { errorMessage: "bounced" },
  });
  await cancelScheduledSendsForLead(leadId);
  await syncLeadToSheet(leadId);
  await prisma.jobRun.create({
    data: { jobType: "bounceCheck", refId: leadId, status: "success", message: "bounce detected" },
  });
}
