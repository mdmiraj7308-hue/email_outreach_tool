import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/gmail/oauth";

export async function GET() {
  try {
    const url = buildAuthUrl();
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Gmail OAuth";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
