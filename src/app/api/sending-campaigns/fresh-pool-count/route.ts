import { NextResponse } from "next/server";
import { getFreshLeadPoolCount } from "@/lib/sendingCampaign";

export async function GET() {
  const count = await getFreshLeadPoolCount();
  return NextResponse.json({ count });
}
