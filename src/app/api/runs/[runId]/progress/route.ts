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

  const [totalLeads, enrichNotDone, qualifiedTotal, qualifiedDrafted] = await Promise.all([
    prisma.lead.count({ where: { campaignRunId: runId } }),
    prisma.lead.count({
      where: { campaignRunId: runId, enrichmentStatus: { not: "done" } },
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

  return NextResponse.json({ totalLeads, enrichNotDone, qualifiedTotal, qualifiedDrafted });
}
