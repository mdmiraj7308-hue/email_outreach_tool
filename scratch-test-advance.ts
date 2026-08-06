import { prisma } from "./src/lib/prisma";
import { advanceEnrichment } from "./src/lib/enrichment/pipeline";

async function main() {
  const runId = "cms4vuc0b000004jptod0ccxr";
  const before = Date.now();
  await advanceEnrichment(runId);
  console.log("one batch took", Date.now() - before, "ms");

  const run = await prisma.campaignRun.findUnique({ where: { id: runId }, select: { status: true } });
  const pending = await prisma.lead.count({
    where: {
      campaignRunId: runId,
      OR: [
        { enrichmentStatus: { in: ["pending", "failed", "unreachable"] } },
        { enrichmentStatus: "done", primaryEmail: "null", leadType: { not: "no_website" } },
      ],
    },
  });
  console.log("run status after:", run?.status, "| pending remaining:", pending);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
