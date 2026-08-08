import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { QUALIFIED_LEAD_WHERE } from "@/lib/leadQualification";

/**
 * Re-syncs every qualified lead in this run to the Google Sheet — pushes
 * current lead/draft state as-is, never drafts anything. Enrichment only
 * summarizes and syncs; drafting is a separate, explicit step via "Write
 * emails + 2 follow-ups" on a Sending Campaign's own page, once a campaign
 * has been created and the lead list audited.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const leads = await prisma.lead.findMany({
    where: { campaignRunId: runId, ...QUALIFIED_LEAD_WHERE },
    select: { id: true },
  });

  let updated = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const lead of leads) {
    const result = await syncLeadToSheet(lead.id).catch((err) => ({
      ok: false as const,
      reason: "sheets_api_error" as const,
      error: err instanceof Error ? err.message : "Unknown error",
    }));
    if (result.ok) {
      updated++;
    } else {
      failed++;
      if (!firstError) {
        firstError =
          result.reason === "not_configured"
            ? "Google Sheets is not configured in Settings."
            : (result.error ?? result.reason);
      }
    }
  }

  return NextResponse.json({ updated, failed, firstError });
}
