import { NextRequest, NextResponse } from "next/server";
import { runDueFollowups } from "@/lib/scheduler/jobs/followupJob";
import { runReplyChecks } from "@/lib/scheduler/jobs/replyCheckJob";
import { runBounceChecks } from "@/lib/scheduler/jobs/bounceCheckJob";
import { runApifyResetIfDue } from "@/lib/scheduler/jobs/apifyResetJob";
import { advanceInProgressScrapes } from "@/lib/scrapeRun";

/**
 * Production's sole trigger for the background jobs (follow-up dispatch,
 * reply checks, bounce checks, and advancing in-progress scrapes one step)
 * — Vercel has no persistent process for the local dev setInterval scheduler
 * (src/lib/scheduler/index.ts) to run in, so an external cron service hits
 * this route on a schedule instead. Guarded by a shared secret (CRON_SECRET)
 * since this URL is otherwise publicly reachable and would let anyone
 * force-dispatch sends.
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await Promise.allSettled([
    runDueFollowups(),
    runReplyChecks(),
    runBounceChecks(),
    runApifyResetIfDue(),
    advanceInProgressScrapes(),
  ]);
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  if (errors.length > 0) {
    console.error("[cron/tick] job(s) failed", errors);
  }

  return NextResponse.json({ ok: errors.length === 0, ranAt: new Date().toISOString(), errors });
}
