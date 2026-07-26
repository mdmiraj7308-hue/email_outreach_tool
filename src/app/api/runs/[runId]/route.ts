import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { deleteLeadRows } from "@/lib/sheets";

/**
 * Deletes an entire campaign run: every lead, their drafts and sends (which
 * also stops any pending follow-ups — a deleted EmailSend can never be
 * dispatched), and their corresponding rows in the connected Google Sheet.
 * The Sheet cleanup is best-effort (reported, not fatal) since the local
 * data is the source of truth and a Sheets API hiccup shouldn't block the
 * user from actually deleting the campaign.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  const run = await prisma.campaignRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Campaign run not found" }, { status: 404 });
  }

  const leads = await prisma.lead.findMany({
    where: { campaignRunId: runId },
    select: { id: true, sheetRowNumber: true },
  });
  const leadIds = leads.map((l) => l.id);
  const sheetRowNumbers = leads
    .map((l) => l.sheetRowNumber)
    .filter((n): n is number => n !== null);

  let sheetDeleted = 0;
  let sheetError: string | undefined;
  if (sheetRowNumbers.length > 0) {
    try {
      const settings = await getSettings();
      if (settings.googleServiceAccountJson && settings.googleSheetId) {
        await deleteLeadRows(
          settings.googleServiceAccountJson,
          settings.googleSheetId,
          sheetRowNumbers
        );
        sheetDeleted = sheetRowNumbers.length;
      }
    } catch (err) {
      sheetError = err instanceof Error ? err.message : "Unknown Google Sheets API error";
      console.error(`[runs/${runId}] failed to delete Sheet rows`, err);
    }
  }

  await prisma.$transaction([
    prisma.emailSend.deleteMany({ where: { leadId: { in: leadIds } } }),
    prisma.emailDraft.deleteMany({ where: { leadId: { in: leadIds } } }),
    prisma.lead.deleteMany({ where: { campaignRunId: runId } }),
    prisma.campaignRun.delete({ where: { id: runId } }),
  ]);

  return NextResponse.json({
    ok: true,
    leadsDeleted: leadIds.length,
    sheetRowsDeleted: sheetDeleted,
    sheetError,
  });
}
