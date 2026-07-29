import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { QUALIFIED_LEAD_WHERE } from "@/lib/leadQualification";

/**
 * Re-syncs every qualified lead in this run to the Google Sheet — pushes
 * current lead/draft state as-is, never drafts anything. Drafting happens
 * automatically the moment a lead qualifies (see enrichLead in
 * src/lib/enrichment/pipeline.ts) and again, per sending campaign, via the
 * "Write emails + 2 follow-ups" action on that campaign's own page.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const leads = await prisma.lead.findMany({
    where: { campaignRunId: runId, ...QUALIFIED_LEAD_WHERE },
    select: { id: true },
  });

  let updated = 0;
  let failed = 0;
  for (const lead of leads) {
    const result = await syncLeadToSheet(lead.id).catch(() => ({ ok: false as const }));
    if (result.ok) updated++;
    else failed++;
  }

  return NextResponse.json({ updated, failed });
}
