import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeEmailsForLead } from "@/lib/emailDrafting";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { QUALIFIED_LEAD_WHERE, filterOutDuplicateEmails } from "@/lib/leadQualification";

const bodySchema = z.object({ customSystemPrompt: z.string().optional() });

interface RouteParams {
  params: Promise<{ runId: string }>;
}

/**
 * Manual retry/catch-up action: drafting now happens automatically the
 * moment a lead qualifies (see enrichLead in src/lib/enrichment/pipeline.ts),
 * so this route no longer runs as the primary drafting step. It exists for
 * leads whose auto-draft failed (e.g. a transient LLM API error) — re-derives
 * the qualified set server-side (same filter as the Step 3 UI toggle) and
 * re-drafts/re-syncs any that are missing drafts or need a refresh. Creates
 * NO EmailSend rows — sending-campaign creation (Phase 2) owns that entirely
 * now, so re-running this can never itself cause anything to be sent.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { runId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const allQualified = await prisma.lead.findMany({
    where: { campaignRunId: runId, ...QUALIFIED_LEAD_WHERE },
    select: { id: true, businessName: true, primaryEmail: true },
  });
  const leads = await filterOutDuplicateEmails(allQualified);
  const duplicatesSkipped = allQualified.length - leads.length;

  const errors: { leadId: string; businessName: string; error: string }[] = [];
  let drafted = 0;

  for (const lead of leads) {
    const result = await writeEmailsForLead(lead.id, parsed.data.customSystemPrompt);
    if (!result.ok) {
      errors.push({ leadId: lead.id, businessName: lead.businessName, error: result.error });
      continue;
    }
    drafted++;
    await syncLeadToSheet(lead.id).catch(() => {});
  }

  return NextResponse.json({
    total: leads.length,
    drafted,
    failed: errors.length,
    duplicatesSkipped,
    errors,
  });
}
