import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyEmailAddress } from "@/lib/emailVerify";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { nullify } from "@/lib/nullify";
import { cancelScheduledSendsForLead } from "@/lib/leadQualification";

// datetime-local inputs send local-time strings with no timezone/seconds
// (e.g. "2026-07-25T14:30"), not full ISO 8601 — parse with `new Date()`
// rather than a strict RFC 3339 validator.
const bodySchema = z.object({
  primaryEmail: z.string().min(1).optional(),
  followup2ScheduledFor: z.string().nullable().optional(),
  followup3ScheduledFor: z.string().nullable().optional(),
});

function parseScheduledFor(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined; // field not sent — leave unchanged
  if (value === null || value.trim() === "") return null; // explicit clear
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Lets a lead's recipient email be corrected inline (e.g. from the Today's
 * Sending / Follow-ups preview) — re-runs the free MX/syntax check against
 * the new address since a manually-typed correction is a new discovery,
 * and clears any prior bounce flag since that applied to the old address.
 * Also accepts manual follow-up 2/3 schedule overrides (any specific
 * date/time); leaving them blank falls back to the Settings-based spacing.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (parsed.data.primaryEmail !== undefined) {
    const primaryEmail = nullify(parsed.data.primaryEmail.trim());
    const emailVerificationStatus = await verifyEmailAddress(primaryEmail);
    if (emailVerificationStatus === "invalid") {
      await cancelScheduledSendsForLead(leadId);
    }
    data.primaryEmail = primaryEmail;
    data.emailVerificationStatus = emailVerificationStatus;
    data.bounced = false;
  }

  const followup2 = parseScheduledFor(parsed.data.followup2ScheduledFor);
  if (followup2 !== undefined) data.followup2ScheduledFor = followup2;
  const followup3 = parseScheduledFor(parsed.data.followup3ScheduledFor);
  if (followup3 !== undefined) data.followup3ScheduledFor = followup3;

  const lead = await prisma.lead.update({ where: { id: leadId }, data });

  // If that follow-up is already queued (not yet sent), move it to the new
  // time rather than only affecting a future not-yet-created one.
  if (followup2) await rescheduleIfPending(leadId, 2, followup2);
  if (followup3) await rescheduleIfPending(leadId, 3, followup3);

  const sheetSync = await syncLeadToSheet(leadId);

  return NextResponse.json({ lead, sheetSync });
}

async function rescheduleIfPending(leadId: string, sequence: number, scheduledFor: Date) {
  await prisma.emailSend.updateMany({
    where: { leadId, sequence, status: "scheduled" },
    data: { scheduledFor },
  });
}
