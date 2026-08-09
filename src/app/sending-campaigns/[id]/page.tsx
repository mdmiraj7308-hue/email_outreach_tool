import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { SendingCampaignView, type CampaignLead } from "@/components/SendingCampaignView";

export const dynamic = "force-dynamic";

export default async function SendingCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const settings = await getSettings();
  const campaign = await prisma.sendingCampaign.findUnique({
    where: { id },
    include: {
      leads: {
        include: {
          lead: { include: { emailDrafts: { orderBy: { sequence: "asc" } } } },
          senderAccount: { select: { emailAddress: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!campaign) notFound();

  const leads: CampaignLead[] = campaign.leads.map((cl) => ({
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
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">{campaign.label}</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">Status: {campaign.status}</p>
      </div>
      <SendingCampaignView
        campaignId={campaign.id}
        status={campaign.status}
        initialLeads={leads}
        followupEnabled={settings.followupEnabled}
        followup2Enabled={settings.followup2Enabled}
      />
    </div>
  );
}
