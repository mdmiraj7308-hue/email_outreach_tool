import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { format } from "date-fns";

export async function GET() {
  const settings = await getSettings();
  const today = format(new Date(), "yyyy-MM-dd");
  const accounts = await prisma.senderAccount.findMany({ orderBy: { createdAt: "asc" } });

  const withCounts = await Promise.all(
    accounts.map(async (account) => {
      const counters = await prisma.dailySendCounter.findMany({
        where: { senderAccountId: account.id, date: today },
      });
      const sentBySequence = (seq: number) => counters.find((c) => c.sequence === seq)?.count ?? 0;
      return {
        id: account.id,
        emailAddress: account.emailAddress,
        isActive: account.isActive,
        dailyCapCold: account.dailyCapCold ?? settings.dailyCapCold,
        dailyCapFollowup2: account.dailyCapFollowup2 ?? settings.dailyCapFollowup2,
        dailyCapFollowup3: account.dailyCapFollowup3 ?? settings.dailyCapFollowup3,
        sentTodayCold: sentBySequence(1),
        sentTodayFollowup2: sentBySequence(2),
        sentTodayFollowup3: sentBySequence(3),
      };
    })
  );

  return NextResponse.json({ accounts: withCounts });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  await prisma.senderAccount.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
