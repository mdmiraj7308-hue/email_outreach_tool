import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateApifyAccount, deleteApifyAccount } from "@/lib/apifyAccounts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  label: z.string().optional(),
  monthlyLimit: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await updateApifyAccount(id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await deleteApifyAccount(id);
  return NextResponse.json({ ok: true });
}
