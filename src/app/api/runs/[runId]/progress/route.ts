import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { QUALIFIED_LEAD_WHERE } from "@/lib/leadQualification";

/**
 * Lightweight poll target for the run page's "Enrich All Pending" and
 * "Write emails" buttons — lets them show a real progress bar (derived from
 * how many leads have left the in-flight bucket) instead of just a spinner,
 * without restructuring either batch operation to report progress directly.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const [run, totalLeads, enrichRemaining, enrichNotDone, enrichDone, enrichFailed, qualifiedTotal, qualifiedDrafted] =
    await Promise.all([
      prisma.campaignRun.findUnique({ where: { id: runId }, select: { status: true } }),
      prisma.lead.count({ where: { campaignRunId: runId } }),
      // Matches pendingEnrichmentWhere in the pipeline exactly — only
      // leads that haven't completed a full attempt yet (never tried, or
      // interrupted mid-batch). "failed"/"unreachable" are terminal now,
      // same as "done", so they're not counted as remaining.
      prisma.lead.count({
        where: { campaignRunId: runId, enrichmentStatus: { in: ["pending", "crawling", "summarizing"] } },
      }),
      prisma.lead.count({
        where: { campaignRunId: runId, enrichmentStatus: { not: "done" } },
      }),
      prisma.lead.count({ where: { campaignRunId: runId, enrichmentStatus: "done" } }),
      prisma.lead.count({
        where: { campaignRunId: runId, enrichmentStatus: { in: ["failed", "unreachable"] } },
      }),
      prisma.lead.count({ where: { campaignRunId: runId, ...QUALIFIED_LEAD_WHERE } }),
      prisma.lead.count({
        where: {
          campaignRunId: runId,
          ...QUALIFIED_LEAD_WHERE,
          emailDrafts: { some: {} },
        },
      }),
    ]);

  return NextResponse.json({
    campaignRunStatus: run?.status ?? null,
    totalLeads,
    enrichRemaining,
    enrichNotDone,
    enrichDone,
    enrichFailed,
    qualifiedTotal,
    qualifiedDrafted,
  });
}
