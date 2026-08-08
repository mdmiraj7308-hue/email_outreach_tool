import { NextRequest, NextResponse } from "next/server";
import { getTodaySends, BUCKET_SEQUENCE } from "@/lib/todaySends";

export async function GET(req: NextRequest) {
  const bucket = req.nextUrl.searchParams.get("bucket") ?? "first";
  if (!BUCKET_SEQUENCE[bucket]) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }
  const result = await getTodaySends(bucket);
  return NextResponse.json(result);
}
