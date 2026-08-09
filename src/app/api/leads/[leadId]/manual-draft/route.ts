import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { EMAIL_PURPOSES } from "@/lib/constants";

const bodySchema = z.object({
  sequence: z.number().int().min(1).max(3),
  subject: z.string().min(1),
  body: z.string().min(1),
});

/**
 * Creates (or updates) one sequence's draft directly from typed content —
 * no AI involved. Used by the Sending Campaign editor now that drafting is
 * manual: PUT /api/drafts/[draftId] only works once a draft row already
 * exists, so a lead with zero drafts had no way to get its first one
 * without this.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { sequence, subject, body } = parsed.data;
  const purpose = EMAIL_PURPOSES[sequence - 1] ?? "cold";

  const draft = await prisma.emailDraft.upsert({
    where: { leadId_sequence: { leadId, sequence } },
    update: { subject, body },
    create: { leadId, sequence, purpose, subject, body },
  });

  const sheetSync = await syncLeadToSheet(leadId);
  return NextResponse.json({ ...draft, sheetSync });
}
