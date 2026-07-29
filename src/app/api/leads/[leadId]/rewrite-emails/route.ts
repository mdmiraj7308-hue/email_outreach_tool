import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rewriteEmailsForLead } from "@/lib/emailDrafting";

const bodySchema = z.object({ feedback: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await rewriteEmailsForLead(leadId, parsed.data.feedback ?? "");
  if (!result.ok) {
    const status = result.error === "Lead not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ drafts: result.drafts });
}
