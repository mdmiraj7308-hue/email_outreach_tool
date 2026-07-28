import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const campaign = await prisma.sendingCampaign.findUnique({
    where: { id },
    include: {
      leads: {
        include: {
          lead: {
            include: { emailDrafts: { orderBy: { sequence: "asc" } } },
          },
          senderAccount: { select: { emailAddress: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: campaign.id,
    label: campaign.label,
    status: campaign.status,
    targetCount: campaign.targetCount,
    createdAt: campaign.createdAt,
    confirmedAt: campaign.confirmedAt,
    leads: campaign.leads.map((cl) => ({
      campaignLeadId: cl.id,
      leadId: cl.leadId,
      businessName: cl.lead.businessName,
      primaryEmail: cl.lead.primaryEmail,
      aboutSummary: cl.lead.aboutSummary !== "null" ? cl.lead.aboutSummary : null,
      senderEmail: cl.senderAccount.emailAddress,
      drafts: cl.lead.emailDrafts.map((d) => ({
        id: d.id,
        sequence: d.sequence,
        subject: d.subject,
        body: d.body,
      })),
    })),
  });
}

/**
 * Cancels a draft campaign — only ever the SendingCampaignLead assignment
 * rows are deleted, never the campaign row itself (kept as "cancelled" for
 * history) and never the underlying Lead/EmailDraft rows. Since the fresh
 * pool query (getFreshLeadPool) only excludes leads that still have a
 * SendingCampaignLead row, deleting those rows is exactly what returns
 * these leads to the fresh qualified pool for a future campaign. Confirmed
 * campaigns can't be cancelled this way — they already have real EmailSend
 * rows scheduled/sent, which this intentionally never touches.
 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const campaign = await prisma.sendingCampaign.findUnique({ where: { id } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "draft") {
    return NextResponse.json(
      { error: `Only draft campaigns can be removed this way (this one is ${campaign.status}).` },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.sendingCampaignLead.deleteMany({ where: { sendingCampaignId: id } }),
    prisma.sendingCampaign.update({ where: { id }, data: { status: "cancelled" } }),
  ]);

  return NextResponse.json({ ok: true });
}
