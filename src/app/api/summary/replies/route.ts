import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Detail behind the Summary page's "Replies" stat tile: which lead replied,
 * and which of your inboxes actually received it. Lead.replyStatus is the
 * only reply flag stored — the account/thread it came in on is derived from
 * that lead's most recent sent email, same lookup replyCheckJob itself uses
 * to decide which thread to poll.
 */
export async function GET() {
  const repliedLeads = await prisma.lead.findMany({
    where: { replyStatus: "Yes" },
    select: { id: true, businessName: true, primaryEmail: true },
  });

  const replies = await Promise.all(
    repliedLeads.map(async (lead) => {
      const lastSend = await prisma.emailSend.findFirst({
        where: { leadId: lead.id, status: "sent" },
        orderBy: { sentAt: "desc" },
        include: { senderAccount: { select: { emailAddress: true } } },
      });
      return {
        leadId: lead.id,
        businessName: lead.businessName,
        primaryEmail: lead.primaryEmail,
        senderEmail: lastSend?.senderAccount?.emailAddress ?? null,
        gmailThreadId: lastSend?.gmailThreadId ?? null,
        sentAt: lastSend?.sentAt?.toISOString() ?? null,
      };
    })
  );

  replies.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));

  return NextResponse.json({ replies });
}
