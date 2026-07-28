import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getActiveLlmClient } from "@/lib/llm";
import { generateBusinessAnalysis } from "@/lib/llm/prompts";
import { crawlWebsite, extractCleanText, isCrawlingAllowed } from "@/lib/enrichment/crawler";
import { extractLinkedInUrl } from "@/lib/enrichment/extractLinkedIn";
import { extractFounderEmail } from "@/lib/enrichment/extractFounderEmail";
import { extractGenericEmail } from "@/lib/enrichment/extractGenericEmail";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { nullify } from "@/lib/nullify";
import { verifyEmailAddress } from "@/lib/emailVerify";
import { cancelScheduledSendsForLead, isLeadQualified } from "@/lib/leadQualification";
import { writeEmailsForLead } from "@/lib/emailDrafting";

const AGGREGATE_TEXT_MAX_CHARS = 6000;
const CONCURRENCY = 3;

export async function enrichLead(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  if (!lead.website || lead.website === "null") {
    // No site to crawl or judge fit on — routed to the separate
    // website-development pitch instead of being dropped from the run.
    await prisma.lead.update({
      where: { id: leadId },
      data: { leadType: "no_website", enrichmentStatus: "done", enrichmentError: null },
    });
    await syncLeadToSheet(leadId);
    return;
  }

  let websiteUrl: URL;
  try {
    websiteUrl = new URL(lead.website);
  } catch {
    await prisma.lead.update({
      where: { id: leadId },
      data: { enrichmentStatus: "failed", enrichmentError: "unparsable website URL" },
    });
    await syncLeadToSheet(leadId);
    return;
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: { enrichmentStatus: "crawling", enrichmentError: null },
  });

  const allowed = await isCrawlingAllowed(websiteUrl.origin);
  if (!allowed) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { enrichmentStatus: "unreachable", enrichmentError: "disallowed by robots.txt" },
    });
    await syncLeadToSheet(leadId);
    return;
  }

  let pages;
  try {
    pages = await crawlWebsite(websiteUrl.toString());
  } catch (err) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        enrichmentStatus: "unreachable",
        enrichmentError: err instanceof Error ? err.message : "crawl failed",
      },
    });
    await syncLeadToSheet(leadId);
    return;
  }

  const linkedinUrl = extractLinkedInUrl(pages);
  const founderEmail = extractFounderEmail(pages);
  // Prefer a named founder/CEO email; fall back to any published on-site
  // email (info@, contact@, etc.) before finally falling back to whatever
  // Apify scraped (Google Maps rarely has one) — still real, on-site
  // contact info even when it's not tied to a specific person.
  const genericEmail = founderEmail ? null : extractGenericEmail(pages, websiteUrl.hostname);
  const primaryEmail =
    founderEmail ?? genericEmail ?? (lead.scrapedEmail !== "null" ? lead.scrapedEmail : null);
  const emailVerificationStatus = await verifyEmailAddress(primaryEmail);
  // A bounce flag applies to the specific address that bounced — if
  // re-enrichment turns up a genuinely different address (e.g. a past
  // extraction bug is corrected), that's an untried address and shouldn't
  // inherit the old one's bounce history.
  const emailChanged = nullify(primaryEmail) !== lead.primaryEmail;

  if (emailVerificationStatus === "invalid") {
    await cancelScheduledSendsForLead(leadId);
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      enrichmentStatus: "summarizing",
      linkedinUrl: nullify(linkedinUrl),
      primaryEmail: nullify(primaryEmail),
      emailVerificationStatus,
      ...(emailChanged ? { bounced: false } : {}),
    },
  });

  const aggregatedText = pages
    .map((p) => extractCleanText(p.html, AGGREGATE_TEXT_MAX_CHARS))
    .join("\n\n")
    .slice(0, AGGREGATE_TEXT_MAX_CHARS);

  try {
    const settings = await getSettings();
    const llm = getActiveLlmClient(settings);
    const analysis = await generateBusinessAnalysis(llm, lead.businessName, aggregatedText);
    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: {
        aboutSummary: nullify(analysis.summary),
        teamSizeEstimate: nullify(analysis.teamSizeEstimate),
        hasManualWorkflows: analysis.hasManualWorkflows,
        hasAiOrTechStaff: analysis.hasAiOrTechStaff,
        fitScore: analysis.fitScore,
        fitVerdict: analysis.fitVerdict,
        fitReason: nullify(analysis.fitReason),
        enrichmentStatus: "done",
        enrichmentError: null,
      },
    });

    // Draft immediately once a lead qualifies — no more manual per-run
    // "Write Emails + Upload to Sheet" step. A drafting failure (e.g. LLM
    // API hiccup) doesn't affect enrichmentStatus; it's just logged and can
    // be retried later without re-enriching.
    if (isLeadQualified(updated)) {
      const result = await writeEmailsForLead(leadId);
      if (!result.ok) {
        console.error(`[enrich] auto-draft failed for lead ${leadId}: ${result.error}`);
      }
    }
  } catch (err) {
    // Crawl/extraction results (LinkedIn, founder email) are still valuable
    // even if the analysis call fails — kept, only this step is marked failed.
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        enrichmentStatus: "failed",
        enrichmentError: err instanceof Error ? err.message : "business analysis failed",
      },
    });
  }

  await syncLeadToSheet(leadId);
}

export interface EnrichRunResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export async function enrichCampaignRun(campaignRunId: string): Promise<EnrichRunResult> {
  const leads = await prisma.lead.findMany({
    where: {
      campaignRunId,
      OR: [
        { enrichmentStatus: { in: ["pending", "failed", "unreachable"] } },
        // "done" but no email ever got extracted is still worth retrying —
        // e.g. an extraction-logic fix landed after this lead was already
        // enriched under the old code. Never applies to "no_website" leads
        // (nothing to re-crawl there).
        { enrichmentStatus: "done", primaryEmail: "null", leadType: { not: "no_website" } },
      ],
    },
    select: { id: true },
  });

  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: { status: "enriching" },
  });

  let succeeded = 0;
  let failed = 0;

  await runWithConcurrency(leads, CONCURRENCY, async (lead) => {
    try {
      await enrichLead(lead.id);
      const updated = await prisma.lead.findUnique({
        where: { id: lead.id },
        select: { enrichmentStatus: true },
      });
      if (updated?.enrichmentStatus === "done") succeeded++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(`[enrich] lead ${lead.id} failed unexpectedly`, err);
      await prisma.lead
        .update({
          where: { id: lead.id },
          data: {
            enrichmentStatus: "failed",
            enrichmentError: err instanceof Error ? err.message : "unexpected error",
          },
        })
        .catch(() => {});
    }
  });

  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: { status: "ready" },
  });

  return { attempted: leads.length, succeeded, failed };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}
