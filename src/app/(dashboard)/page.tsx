import Link from "next/link";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { ScrapeForm } from "@/components/ScrapeForm";
import { DeleteCampaignButton } from "@/components/DeleteCampaignButton";
import { statusBadgeClass } from "@/lib/ui";

// This list changes as scrapes/enrichment/sends progress in the background —
// never serve a stale build-time snapshot.
export const dynamic = "force-dynamic";

function initials(label: string): string {
  const words = label.split(/[\s—-]+/).filter(Boolean);
  const source = words[1] ?? words[0] ?? "?";
  return source.slice(0, 2).toUpperCase();
}

export default async function DashboardPage() {
  const runs = await prisma.campaignRun.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
  });

  const grouped = new Map<string, typeof runs>();
  for (const run of runs) {
    const key = format(run.createdAt, "yyyy-MM-dd");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(run);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--ink)]">Campaigns</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Scrape, enrich, and send outreach campaigns to local businesses.
          </p>
        </div>
        <ScrapeForm />
      </div>

      {runs.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-light)] text-[var(--brand-dark)]">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9-4 9 4-9 4-9-4z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9 4 9-4M3 17l9 4 9-4" />
            </svg>
          </div>
          <p className="font-medium text-[var(--ink)]">No campaigns yet</p>
          <p className="max-w-sm text-sm text-[var(--ink-soft)]">
            Click "New Scrape" to pull local business leads from Google Maps and start your
            first outreach campaign.
          </p>
        </div>
      )}

      {[...grouped.entries()].map(([date, dateRuns]) => (
        <section key={date} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
            {format(new Date(date), "EEEE, MMMM d, yyyy")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {dateRuns.map((run) => (
              <div
                key={run.id}
                className="group relative flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm transition hover:border-[var(--brand)] hover:shadow-md"
              >
                <Link href={`/runs/${run.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-light)] text-sm font-semibold text-[var(--brand-dark)]">
                    {initials(run.label)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[var(--ink)]">{run.label}</p>
                    <p className="text-sm text-[var(--ink-soft)]">
                      {run._count.leads} lead{run._count.leads === 1 ? "" : "s"}
                    </p>
                  </div>
                </Link>
                <span className={statusBadgeClass(run.status)}>{run.status}</span>
                <DeleteCampaignButton campaignRunId={run.id} label={run.label} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
