import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForAccount, upsertSenderAccount } from "@/lib/gmail/oauth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";

  if (!code) {
    return NextResponse.redirect(`${base}/settings?gmailError=${encodeURIComponent("Missing OAuth code")}`);
  }

  try {
    const account = await exchangeCodeForAccount(code);
    await upsertSenderAccount(account);
    return NextResponse.redirect(`${base}/settings?gmailConnected=${encodeURIComponent(account.emailAddress)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect Gmail account";
    return NextResponse.redirect(`${base}/settings?gmailError=${encodeURIComponent(message)}`);
  }
}
