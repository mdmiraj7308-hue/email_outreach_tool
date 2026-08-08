import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Undoes a failed send so the lead can be picked up in a fresh sending
 * campaign: deletes the failed EmailSend (its emailDraftId is unique, so a
 * new send can't be created for that draft while the old failed one still
 * occupies it) and clears the lead's SendingCampaignLead association(s)
 * (getFreshLeadCandidates excludes any lead already tied to one).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ sendId: string }> }) {
  const { sendId } = await params;

  const send = await prisma.emailSend.findUnique({
    where: { id: sendId },
    select: { id: true, status: true, leadId: true },
  });
  if (!send) {
    return NextResponse.json({ error: "Send not found" }, { status: 404 });
  }
  if (send.status !== "failed") {
    return NextResponse.json({ error: "Only failed sends can be restored" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.sendingCampaignLead.deleteMany({ where: { leadId: send.leadId } }),
    prisma.emailSend.delete({ where: { id: sendId } }),
  ]);

  return NextResponse.json({ ok: true });
}
