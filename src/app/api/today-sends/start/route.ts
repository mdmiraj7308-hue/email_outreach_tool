import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";
import { BUCKET_SEQUENCE } from "@/lib/todaySends";

const bodySchema = z.object({ bucket: z.enum(["first", "followup1", "followup2"]) });

/**
 * Explicit "release for sending" action — the only thing that makes the
 * background scheduler's next tick (within 60s) actually dispatch anything.
 * Two groups get pulled in: "ready" rows (drafted via Write Emails +
 * Upload, never auto-sent) get flipped to "scheduled" now; anything
 * already "scheduled" for later today (e.g. a follow-up whose spacing
 * happens to land today) gets pulled forward to now too. This route
 * itself never sends — it just queues, so the request returns immediately.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const sequence = BUCKET_SEQUENCE[parsed.data.bucket];
  const now = new Date();

  // Nudge first, release second — otherwise a "ready" row the release step
  // just flipped to "scheduled" would immediately match the nudge query's
  // own where clause too, double-counting the same row in the response.
  const { count: nudged } = await prisma.emailSend.updateMany({
    where: {
      sequence,
      status: "scheduled",
      scheduledFor: { gte: startOfDay(now), lte: endOfDay(now) },
    },
    data: { scheduledFor: now },
  });

  const { count: released } = await prisma.emailSend.updateMany({
    where: { sequence, status: "ready" },
    data: { status: "scheduled", scheduledFor: now },
  });

  return NextResponse.json({ queued: released + nudged });
}
