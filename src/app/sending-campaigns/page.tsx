import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CreateCampaignButton } from "@/components/CreateCampaignButton";
import { RemoveDraftCampaignButton } from "@/components/RemoveDraftCampaignButton";
import { card, badgeClass } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function SendingCampaignsPage() {
  const campaigns = await prisma.sendingCampaign.findMany({
    where: { status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">Sending Campaigns</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Batches of leads drawn from your fresh qualified pool for review, then scheduled to
            send within business hours.
          </p>
        </div>
        <CreateCampaignButton />
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center text-sm text-[var(--ink-soft)]">
          No sending campaigns yet.
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/sending-campaigns/${c.id}`} className={`block ${card}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--ink)]">{c.label}</p>
                  <p className="text-sm text-[var(--ink-soft)]">{c._count.leads} leads</p>
                </div>
                <div className="flex items-center gap-2">
                  {c.status === "draft" && <RemoveDraftCampaignButton campaignId={c.id} />}
                  <span className={badgeClass(c.status === "draft" ? "amber" : "green")}>{c.status}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
