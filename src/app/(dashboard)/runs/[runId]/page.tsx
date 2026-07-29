import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RunStatusPoller } from "@/components/RunStatusPoller";
import { ScrapeProgressBar } from "@/components/ScrapeProgressBar";
import { EnrichRunButton } from "@/components/EnrichRunButton";
import { UpdateSheetButton } from "@/components/UpdateSheetButton";
import { statusBadgeClass, fitBadge, emailDeliverabilityBadge, badgeClass } from "@/lib/ui";
import { LEAD_FILTER_MIN_FIT_SCORE } from "@/lib/constants";
import { QUALIFIED_LEAD_WHERE, getDuplicateEmailLeadIds } from "@/lib/leadQualification";

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { runId } = await params;
  const { filter } = await searchParams;
  const qualifiedOnly = filter === "qualified";

  const [run, totalLeadsCount, qualifiedLeadsCount] = await Promise.all([
    prisma.campaignRun.findUnique({
      where: { id: runId },
      include: {
        leads: {
          orderBy: { createdAt: "asc" },
          include: { emailSends: true },
          where: qualifiedOnly ? QUALIFIED_LEAD_WHERE : undefined,
        },
      },
    }),
    prisma.lead.count({ where: { campaignRunId: runId } }),
    prisma.lead.count({ where: { campaignRunId: runId, ...QUALIFIED_LEAD_WHERE } }),
  ]);

  if (!run) notFound();

  // Leads whose email address already got a successful send under a
  // DIFFERENT lead (same business scraped twice into separate rows) —
  // excluded from "Qualified Only", flagged with a badge in "All Leads".
  const duplicateBlockedIds = await getDuplicateEmailLeadIds(
    run.leads.map((l) => ({ id: l.id, primaryEmail: l.primaryEmail }))
  );
  const visibleLeads = qualifiedOnly
    ? run.leads.filter((l) => !duplicateBlockedIds.has(l.id))
    : run.leads;

  return (
    <div className="space-y-6">
      <RunStatusPoller runId={run.id} status={run.status} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">{run.label}</h1>
            <span className={statusBadgeClass(run.status)}>{run.status}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            {run.searchQuery} in {run.location}
          </p>
          {run.preferredService !== "null" && (
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              <span className="font-medium text-[var(--ink)]">Pitching:</span>{" "}
              {run.preferredService}
            </p>
          )}
          {run.duplicatesSkipped > 0 && (
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Skipped {run.duplicatesSkipped} lead{run.duplicatesSkipped === 1 ? "" : "s"} already
              in your pipeline from a prior scrape.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <EnrichRunButton campaignRunId={run.id} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-white p-1 w-fit">
          <Link
            href={`/runs/${run.id}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              !qualifiedOnly
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--ink-soft)] hover:bg-neutral-50"
            }`}
          >
            All Leads ({totalLeadsCount})
          </Link>
          <Link
            href={`/runs/${run.id}?filter=qualified`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              qualifiedOnly
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--ink-soft)] hover:bg-neutral-50"
            }`}
          >
            Qualified Only ({qualifiedLeadsCount}/{totalLeadsCount}) — email + fit ≥{" "}
            {LEAD_FILTER_MIN_FIT_SCORE}
          </Link>
        </div>
        {qualifiedOnly && <UpdateSheetButton campaignRunId={run.id} />}
      </div>

      {visibleLeads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-16 text-center text-sm text-[var(--ink-soft)]">
          {run.status === "scraping" || run.status === "pending" ? (
            <ScrapeProgressBar runId={run.id} maxLeads={run.maxLeads} />
          ) : qualifiedOnly ? (
            "No leads meet the qualification filter yet."
          ) : (
            "No leads found for this run."
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
              <tr>
                <th className="px-5 py-3">Business Name</th>
                <th className="px-5 py-3">Website</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Enrichment</th>
                <th className="px-5 py-3">Fit</th>
                <th className="px-5 py-3">Sent</th>
                <th className="px-5 py-3">Reply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {visibleLeads.map((lead) => (
                <tr key={lead.id} className="transition hover:bg-[var(--brand-light)]/40">
                  <td className="px-5 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium text-[var(--ink)] hover:text-[var(--brand-dark)]"
                    >
                      {lead.businessName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-[var(--ink-soft)]">{lead.website}</td>
                  <td className="px-5 py-3 text-[var(--ink-soft)]">
                    <div className="flex items-center gap-2">
                      <span>{lead.primaryEmail}</span>
                      {(() => {
                        const badge = emailDeliverabilityBadge(
                          lead.emailVerificationStatus,
                          lead.bounced
                        );
                        return badge ? <span className={badge.className}>{badge.label}</span> : null;
                      })()}
                      {duplicateBlockedIds.has(lead.id) && (
                        <span className={badgeClass("purple")}>Duplicate</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-[var(--ink-soft)]">{lead.phone}</td>
                  <td className="px-5 py-3">
                    <span className={statusBadgeClass(lead.enrichmentStatus)}>
                      {lead.enrichmentStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {(() => {
                      const fit = fitBadge(lead.leadType, lead.fitScore);
                      return <span className={fit.className}>{fit.label}</span>;
                    })()}
                  </td>
                  <td className="px-5 py-3 text-[var(--ink-soft)]">
                    {lead.emailSends.filter((s) => s.status === "sent").length} / 3
                  </td>
                  <td className="px-5 py-3">
                    <span className={statusBadgeClass(lead.replyStatus === "Yes" ? "sent" : "neutral")}>
                      {lead.replyStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
