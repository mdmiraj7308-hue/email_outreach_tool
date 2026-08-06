import { prisma } from "./src/lib/prisma";
import { advanceAllInProgressEnrichments } from "./src/lib/enrichment/pipeline";

const runId = "cms4vuc0b000004jptod0ccxr";

async function snapshot(label: string) {
  const incomplete = await prisma.lead.count({
    where: { campaignRunId: runId, enrichmentStatus: { in: ["pending", "failed", "unreachable", "crawling", "summarizing"] } },
  });
  console.log(label, "| incomplete:", incomplete);
  return incomplete;
}

async function main() {
  await snapshot("start");
  for (let i = 0; i < 3; i++) {
    await advanceAllInProgressEnrichments();
    await snapshot(`after call ${i + 1}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
