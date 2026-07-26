import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { pickAccountAndSend } from "@/lib/gmail/sendQueue";

const bodySchema = z.object({
  leadId: z.string().min(1),
  sequence: z.number().int().min(1).max(3).default(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const outcome = await sendLeadEmailNow(parsed.data.leadId, parsed.data.sequence);
  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  }
  return NextResponse.json(outcome.result);
}

/**
 * Manual "Send Now" for a single lead/sequence — creates the EmailSend row
 * and dispatches it immediately via the same sendQueue the background
 * scheduler uses, so caps/rotation behave identically either way. This is
 * the ONLY way a "ready" (drafted-but-not-released) send can go out
 * outside of an explicit "Start Sending" click on the Today's Sending tab.
 */
async function sendLeadEmailNow(leadId: string, sequence: number) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return { error: "Lead not found", httpStatus: 404 } as const;
  }
  if (!lead.primaryEmail || lead.primaryEmail === "null") {
    return { error: "Lead has no email address to send to", httpStatus: 400 } as const;
  }
  if (lead.replyStatus === "Yes") {
    return { error: "Lead has already replied — sending is disabled", httpStatus: 400 } as const;
  }

  const draft = await prisma.emailDraft.findUnique({
    where: { leadId_sequence: { leadId, sequence } },
  });
  if (!draft) {
    return { error: `No email draft for sequence ${sequence}`, httpStatus: 400 } as const;
  }

  const existing = await prisma.emailSend.findUnique({ where: { emailDraftId: draft.id } });
  if (existing && existing.status === "scheduled") {
    return { error: "This email is already queued to send", httpStatus: 400 } as const;
  }

  const send = existing
    ? await prisma.emailSend.update({
        // Explicit manual (re)send — covers retrying a failed send,
        // releasing a "ready" draft immediately, and deliberately
        // resending after correcting a lead's email address.
        // pickAccountAndSend only dispatches sends still in "scheduled"
        // state, and clearing the prior send's metadata here means a
        // stale gmailMessageId/sentAt never lingers if this resend fails.
        where: { id: existing.id },
        data: {
          status: "scheduled",
          scheduledFor: new Date(),
          errorMessage: null,
          sentAt: null,
          gmailMessageId: null,
          gmailThreadId: null,
          senderAccountId: null,
          sentManually: true,
        },
      })
    : await prisma.emailSend.create({
        data: {
          leadId,
          emailDraftId: draft.id,
          sequence,
          scheduledFor: new Date(),
          status: "scheduled",
          sentManually: true,
        },
      });

  const result = await pickAccountAndSend(send.id);
  return { result } as const;
}
