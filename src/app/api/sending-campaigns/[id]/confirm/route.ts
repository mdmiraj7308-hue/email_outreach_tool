import { NextResponse } from "next/server";
import { confirmSendingCampaign } from "@/lib/sendingCampaign";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const result = await confirmSendingCampaign(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
