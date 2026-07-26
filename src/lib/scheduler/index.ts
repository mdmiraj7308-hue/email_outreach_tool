import { runDueFollowups } from "@/lib/scheduler/jobs/followupJob";
import { runReplyChecks } from "@/lib/scheduler/jobs/replyCheckJob";
import { runBounceChecks } from "@/lib/scheduler/jobs/bounceCheckJob";
import { advanceInProgressScrapes } from "@/lib/scrapeRun";
import {
  FOLLOWUP_JOB_INTERVAL_MS,
  REPLY_CHECK_JOB_INTERVAL_MS,
  BOUNCE_CHECK_JOB_INTERVAL_MS,
  SCRAPE_ADVANCE_JOB_INTERVAL_MS,
} from "@/lib/constants";

declare global {
  // eslint-disable-next-line no-var
  var __schedulerStarted: boolean | undefined;
}

let followupJobRunning = false;
let replyCheckJobRunning = false;
let bounceCheckJobRunning = false;
let scrapeAdvanceJobRunning = false;

async function tickFollowups() {
  if (followupJobRunning) return; // previous tick still running — skip, don't overlap
  followupJobRunning = true;
  try {
    await runDueFollowups();
  } catch (err) {
    console.error("[scheduler] followup job failed", err);
  } finally {
    followupJobRunning = false;
  }
}

async function tickReplyChecks() {
  if (replyCheckJobRunning) return;
  replyCheckJobRunning = true;
  try {
    await runReplyChecks();
  } catch (err) {
    console.error("[scheduler] reply check job failed", err);
  } finally {
    replyCheckJobRunning = false;
  }
}

async function tickBounceChecks() {
  if (bounceCheckJobRunning) return;
  bounceCheckJobRunning = true;
  try {
    await runBounceChecks();
  } catch (err) {
    console.error("[scheduler] bounce check job failed", err);
  } finally {
    bounceCheckJobRunning = false;
  }
}

async function tickScrapeAdvance() {
  if (scrapeAdvanceJobRunning) return;
  scrapeAdvanceJobRunning = true;
  try {
    await advanceInProgressScrapes();
  } catch (err) {
    console.error("[scheduler] scrape advance job failed", err);
  } finally {
    scrapeAdvanceJobRunning = false;
  }
}

export function initScheduler() {
  if (globalThis.__schedulerStarted) return;
  globalThis.__schedulerStarted = true;

  // Boot catch-up pass: anything that became due while the server was down
  // fires now instead of waiting for the next interval.
  void tickFollowups();
  void tickReplyChecks();
  void tickBounceChecks();
  void tickScrapeAdvance();

  setInterval(tickFollowups, FOLLOWUP_JOB_INTERVAL_MS);
  setInterval(tickReplyChecks, REPLY_CHECK_JOB_INTERVAL_MS);
  setInterval(tickBounceChecks, BOUNCE_CHECK_JOB_INTERVAL_MS);
  setInterval(tickScrapeAdvance, SCRAPE_ADVANCE_JOB_INTERVAL_MS);

  console.log("[scheduler] initialized");
}
