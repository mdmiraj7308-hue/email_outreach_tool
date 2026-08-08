import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 50;

/**
 * Full send history — every real send attempt (sent or failed), most
 * recent first, with the exact timestamp. Distinct from Today's Sending
 * (today's queue only) and Stats (aggregate daily counts) — this is the
 * per-email audit log.
 */
export async function GET(req: NextRequest) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));

  const where = { status: { in: ["sent", "failed"] } };

  const [sends, total] = await Promise.all([
    prisma.emailSend.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        lead: { select: { businessName: true, primaryEmail: true } },
        senderAccount: { select: { emailAddress: true } },
        emailDraft: { select: { subject: true } },
      },
    }),
    prisma.emailSend.count({ where }),
  ]);

  // A failed send has no sentAt (it never actually sent), and scheduledFor
  // is just the shared campaign time-slot multiple leads on the same
  // account/day were assigned — NOT when the system actually attempted it,
  // which made spaced-out real attempts look like they all fired at once.
  // JobRun.runAt is the real per-attempt timestamp the dispatch loop logs;
  // fall back to it, one lookup for the whole page rather than per-row.
  const jobRuns = await prisma.jobRun.findMany({
    where: { refId: { in: sends.map((s) => s.id) }, jobType: "followup" },
    orderBy: { runAt: "desc" },
    select: { refId: true, runAt: true },
  });
  const latestAttemptBySendId = new Map<string, Date>();
  for (const j of jobRuns) {
    if (j.refId && !latestAttemptBySendId.has(j.refId)) latestAttemptBySendId.set(j.refId, j.runAt);
  }

  return NextResponse.json({
    sends: sends.map((s) => ({
      id: s.id,
      businessName: s.lead.businessName,
      recipient: s.lead.primaryEmail,
      sequence: s.sequence,
      subject: s.emailDraft.subject,
      senderEmail: s.senderAccount?.emailAddress ?? null,
      status: s.status,
      attemptedAt: (s.sentAt ?? latestAttemptBySendId.get(s.id) ?? s.scheduledFor).toISOString(),
      errorMessage: s.errorMessage,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
