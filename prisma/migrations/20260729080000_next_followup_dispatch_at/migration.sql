-- Persisted cooldown gate for the follow-up dispatch loop (replaces an
-- in-process sleep that doesn't survive Vercel's per-invocation execution
-- time limit).
ALTER TABLE "Settings" ADD COLUMN "nextFollowupDispatchAt" TIMESTAMP(3);
