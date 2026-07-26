import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startCampaignScrape } from "@/lib/scrapeRun";

const scrapeSchema = z.object({
  searchQuery: z.string().min(1),
  location: z.string().min(1),
  maxLeads: z.number().int().positive().max(500),
  preferredService: z.string().optional(),
  additionalLocations: z.array(z.string().min(1)).optional(),
  autoGrid: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = scrapeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const run = await startCampaignScrape(parsed.data);
    return NextResponse.json({ campaignRunId: run.id, status: run.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start scrape";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
