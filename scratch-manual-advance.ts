import { prisma } from "./src/lib/prisma";
import { advanceAllInProgressEnrichments } from "./src/lib/enrichment/pipeline";

async function main() {
  const before = await prisma.lead.count({ where: { campaignRunId: "cms4vuc0b000004jptod0ccxr", enrichmentStatus: "done" } });
  console.log("done before:", before);
  const start = Date.now();
  await advanceAllInProgressEnrichments();
  console.log("advance call took", Date.now() - start, "ms");
  const after = await prisma.lead.count({ where: { campaignRunId: "cms4vuc0b000004jptod0ccxr", enrichmentStatus: "done" } });
  console.log("done after:", after);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
