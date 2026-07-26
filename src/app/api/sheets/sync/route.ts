import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { syncCampaignRunToSheet } from "@/lib/leadSheetSync";

const bodySchema = z.object({ campaignRunId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await syncCampaignRunToSheet(parsed.data.campaignRunId);

  if (result.failed > 0 && result.succeeded === 0) {
    return NextResponse.json(
      { error: result.firstError ?? "Failed to sync to Google Sheets", ...result },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
