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

  return NextResponse.json({
    sends: sends.map((s) => ({
      id: s.id,
      businessName: s.lead.businessName,
      recipient: s.lead.primaryEmail,
      sequence: s.sequence,
      subject: s.emailDraft.subject,
      senderEmail: s.senderAccount?.emailAddress ?? null,
      status: s.status,
      sentAt: s.sentAt?.toISOString() ?? null,
      scheduledFor: s.scheduledFor.toISOString(),
      errorMessage: s.errorMessage,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
