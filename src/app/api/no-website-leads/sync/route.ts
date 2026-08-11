import { NextResponse } from "next/server";
import { syncPendingNoWebsiteLeads } from "@/lib/leadSheetSync";

export async function POST() {
  const result = await syncPendingNoWebsiteLeads();
  return NextResponse.json(result);
}
