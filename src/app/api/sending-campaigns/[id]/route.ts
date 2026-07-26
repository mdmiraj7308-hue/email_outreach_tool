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
