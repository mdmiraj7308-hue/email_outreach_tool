import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { syncLeadToSheet } from "@/lib/leadSheetSync";

const bodySchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const { draftId } = await params;
  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const draft = await prisma.emailDraft.update({
    where: { id: draftId },
    data: parsed.data,
    include: { lead: { select: { id: true } } },
  });

  const sheetSync = await syncLeadToSheet(draft.lead.id);

  return NextResponse.json({ ...draft, sheetSync });
}
