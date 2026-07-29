import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeEmailsForLead } from "@/lib/emailDrafting";

/**
 * Drafts (or re-drafts) all 3 sequence emails for every lead in this
 * sending campaign — the step between "Create Campaign" (which no longer
 * requires drafts to already exist, see getFreshLeadCandidates) and
 * "Confirm & Schedule" (which now refuses to run until every lead here has
 * a full draft set). Safe to call again later too — writeEmailsForLead
 * upserts, so re-running just refreshes the content.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const campaign = await prisma.sendingCampaign.findUnique({
    where: { id },
    include: { leads: { select: { leadId: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "draft") {
    return NextResponse.json({ error: `Campaign is already ${campaign.status}` }, { status: 400 });
  }

  const results: {
    leadId: string;
    ok: boolean;
    drafts?: { id: string; sequence: number; subject: string; body: string }[];
    error?: string;
  }[] = [];

  for (const { leadId } of campaign.leads) {
    const result = await writeEmailsForLead(leadId);
    results.push(
      result.ok
        ? {
            leadId,
            ok: true,
            drafts: result.drafts.map((d) => ({ id: d.id, sequence: d.sequence, subject: d.subject, body: d.body })),
          }
        : { leadId, ok: false, error: result.error }
    );
  }

  return NextResponse.json({ results });
}
