import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enrichLead, enrichCampaignRun } from "@/lib/enrichment/pipeline";

const bodySchema = z.union([
  z.object({ campaignRunId: z.string().min(1) }),
  z.object({ leadId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    if ("leadId" in parsed.data) {
      await enrichLead(parsed.data.leadId);
      return NextResponse.json({ ok: true });
    }
    const result = await enrichCampaignRun(parsed.data.campaignRunId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enrichment failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
