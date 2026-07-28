import { prisma } from "./src/lib/prisma";

async function main() {
  const run = await prisma.campaignRun.findFirst({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true, noWebsiteLeads: true } } },
  });
  console.log("Latest run:", run?.label);
  console.log("status:", run?.status, "maxLeads:", run?.maxLeads, "duplicatesSkipped:", run?.duplicatesSkipped);
  console.log("leads (with website):", run?._count.leads);
  console.log("noWebsiteLeads:", run?._count.noWebsiteLeads);
  console.log("sum:", (run?._count.leads ?? 0) + (run?._count.noWebsiteLeads ?? 0) + (run?.duplicatesSkipped ?? 0));
  console.log("total leads in DB (all runs, all time):", await prisma.lead.count());
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
