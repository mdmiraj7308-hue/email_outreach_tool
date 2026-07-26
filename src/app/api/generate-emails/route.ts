import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeEmailsForLead } from "@/lib/emailDrafting";

const bodySchema = z.object({
  leadId: z.string().min(1),
  customSystemPrompt: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await writeEmailsForLead(parsed.data.leadId, parsed.data.customSystemPrompt);
  if (!result.ok) {
    const status = result.error === "Lead not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ drafts: result.drafts });
}
