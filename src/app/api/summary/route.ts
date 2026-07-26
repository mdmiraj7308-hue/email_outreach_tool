import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshSenderSpamScore } from "@/lib/spamCheck";

const STALE_MS = 10 * 60 * 1000;

export async function GET() {
  const [totalLeadsScraped, totalSent, followup1Sent, followup2Sent, replyCount, accounts] =
    await Promise.all([
      prisma.lead.count(),
      prisma.emailSend.count({ where: { status: "sent" } }),
      prisma.emailSend.count({ where: { status: "sent", sequence: 2 } }),
      prisma.emailSend.count({ where: { status: "sent", sequence: 3 } }),
      prisma.lead.count({ where: { replyStatus: "Yes" } }),
      prisma.senderAccount.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

  const perSender = await Promise.all(
    accounts.map(async (account) => {
      const stale =
        !account.spamScoreUpdatedAt ||
        Date.now() - account.spamScoreUpdatedAt.getTime() > STALE_MS;
      const spamScore = stale ? await refreshSenderSpamScore(account.id) : account.spamScore;

      const [sentCount, failedCount] = await Promise.all([
        prisma.emailSend.count({ where: { senderAccountId: account.id, status: "sent" } }),
        prisma.emailSend.count({ where: { senderAccountId: account.id, status: "failed" } }),
      ]);

      return {
        senderAccountId: account.id,
        emailAddress: account.emailAddress,
        sentCount,
        failedCount,
        spamScore,
      };
    })
  );

  return NextResponse.json({
    totalLeadsScraped,
    totalSent,
    successfulSends: totalSent,
    followup1Sent,
    followup2Sent,
    replyCount,
    perSender,
  });
}
