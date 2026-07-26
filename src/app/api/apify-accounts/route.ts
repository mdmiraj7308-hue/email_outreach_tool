import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listApifyAccounts, createApifyAccount } from "@/lib/apifyAccounts";

export async function GET() {
  const accounts = await listApifyAccounts();
  return NextResponse.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      leadsScraped: a.leadsScraped,
      monthlyLimit: a.monthlyLimit,
      isActive: a.isActive,
    })),
  });
}

const bodySchema = z.object({
  token: z.string().min(1),
  label: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await createApifyAccount(parsed.data.token, parsed.data.label);
  return NextResponse.json({ ok: true });
}
