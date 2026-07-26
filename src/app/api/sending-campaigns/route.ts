import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSendingCampaign } from "@/lib/sendingCampaign";

const bodySchema = z.object({ targetCount: z.number().int().positive().max(1000) });

export async function GET() {
  const campaigns = await prisma.sendingCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
  });
  return NextResponse.json({
    campaigns: campaigns.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      targetCount: c.targetCount,
      leadCount: c._count.leads,
      createdAt: c.createdAt,
      confirmedAt: c.confirmedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await createSendingCampaign(parsed.data.targetCount);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
