import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = await prisma.campaignRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, _count: { select: { leads: true } } },
  });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({
    campaignRunId: run.id,
    status: run.status,
    leadCount: run._count.leads,
  });
}
