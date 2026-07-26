import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { format, subDays } from "date-fns";

export async function GET(req: NextRequest) {
  const rangeDays = Number(req.nextUrl.searchParams.get("range") ?? "14");
  const today = format(new Date(), "yyyy-MM-dd");
  const startDate = format(subDays(new Date(), rangeDays - 1), "yyyy-MM-dd");

  const accounts = await prisma.senderAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, emailAddress: true },
  });

  const counters = await prisma.dailySendCounter.findMany({
    where: { date: { gte: startDate } },
    orderBy: { date: "asc" },
  });

  const accountEmailById = new Map(accounts.map((a) => [a.id, a.emailAddress]));

  const historyByDate = new Map<string, Record<string, number>>();
  for (const counter of counters) {
    const email = accountEmailById.get(counter.senderAccountId) ?? "unknown";
    if (!historyByDate.has(counter.date)) historyByDate.set(counter.date, {});
    historyByDate.get(counter.date)![email] = counter.count;
  }

  const dates: string[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    dates.push(format(subDays(new Date(), i), "yyyy-MM-dd"));
  }

  const history = dates.map((date) => ({
    date,
    ...Object.fromEntries(accounts.map((a) => [a.emailAddress, historyByDate.get(date)?.[a.emailAddress] ?? 0])),
  }));

  const todayByAccount = accounts.map((a) => ({
    email: a.emailAddress,
    count: historyByDate.get(today)?.[a.emailAddress] ?? 0,
  }));
  const todayTotal = todayByAccount.reduce((sum, x) => sum + x.count, 0);

  return NextResponse.json({
    today: { total: todayTotal, byAccount: todayByAccount },
    history,
    accountEmails: accounts.map((a) => a.emailAddress),
  });
}
