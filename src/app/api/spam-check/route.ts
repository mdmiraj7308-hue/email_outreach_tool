import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scoreEmailContent } from "@/lib/spamCheck";

const bodySchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = scoreEmailContent(parsed.data.subject, parsed.data.body);
  return NextResponse.json(result);
}
