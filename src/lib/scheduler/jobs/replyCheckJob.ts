import { prisma } from "@/lib/prisma";
import { ensureFreshAccessToken } from "@/lib/gmail/oauth";
import { threadHasReplyFrom } from "@/lib/gmail/client";
import { syncLeadToSheet } from "@/lib/leadSheetSync";

/**
 * For every lead that hasn't replied yet and has at least one sent email,
 * checks the most recent sent thread for a reply from someone other than
 * the sending account. If found, marks the lead replied and cancels any
 * remaining scheduled follow-ups for it.
 */
export async function runReplyChecks(): Promise<void> {
  const candidates = await prisma.emailSend.findMany({
    where: {
      status: "sent",
      lead: { replyStatus: "No" },
      gmailThreadId: { not: null },
    },
    orderBy: { sentAt: "desc" },
    include: { senderAccount: true },
  });

  // Only need the most recent sent thread per lead.
  const latestPerLead = new Map<string, (typeof candidates)[number]>();
  for (const send of candidates) {
    if (!latestPerLead.has(send.leadId)) {
      latestPerLead.set(send.leadId, send);
    }
  }

  for (const send of latestPerLead.values()) {
    if (!send.senderAccount || !send.gmailThreadId || !send.sentAt) continue;

    try {
      const accessToken = await ensureFreshAccessToken(send.senderAccount);
      const hasReply = await threadHasReplyFrom({
        accessToken,
        threadId: send.gmailThreadId,
        ownEmailAddress: send.senderAccount.emailAddress,
        sinceMs: send.sentAt.getTime(),
      });

      if (hasReply) {
        await markLeadReplied(send.leadId);
      }
    } catch (err) {
      console.error(`[replyCheckJob] failed to check thread for lead ${send.leadId}`, err);
      await prisma.jobRun
        .create({
          data: {
            jobType: "replyCheck",
            refId: send.leadId,
            status: "failed",
            message: err instanceof Error ? err.message : "unexpected error",
          },
        })
        .catch(() => {});
    }
  }
}

async function markLeadReplied(leadId: string) {
  await prisma.lead.update({ where: { id: leadId }, data: { replyStatus: "Yes" } });
  await prisma.emailSend.updateMany({
    where: { leadId, status: "scheduled" },
    data: { status: "skipped_reply" },
  });
  await syncLeadToSheet(leadId);
  await prisma.jobRun.create({
    data: { jobType: "replyCheck", refId: leadId, status: "success", message: "reply detected" },
  });
}
