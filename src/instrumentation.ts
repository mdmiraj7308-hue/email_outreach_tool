export async function register() {
  // Only run in the Node.js server runtime (not edge, not the client bundle).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // On Vercel there's no persistent process for setInterval to run in —
  // each serverless invocation is its own short-lived instance. Production
  // relies on GET /api/cron/tick, triggered externally on a schedule,
  // instead of this in-process scheduler (which is still used for local dev).
  if (process.env.VERCEL) return;

  const { initScheduler } = await import("@/lib/scheduler");
  initScheduler();
}
