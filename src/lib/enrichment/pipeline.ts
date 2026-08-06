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
}

// Deliberately does NOT include "done but no email ever got extracted" —
// that used to be retried indefinitely (meant for a one-off manual re-run
// after an extraction-logic fix), but under the incremental advanceEnrichment
// loop that becomes a genuine infinite loop: a site with no discoverable
// email just comes back emailless every time, so the retry pool never
// empties and the run can never reach "ready". Confirmed in production —
// 76 emailless leads were being endlessly recycled instead of the run
// finishing. "done" is done, even without an email; only real incomplete
// states are retried automatically here.
function pendingEnrichmentWhere(campaignRunId: string) {
  return {
    campaignRunId,
    // "crawling"/"summarizing" are enrichLead's own intermediate states —
    // included so a lead interrupted mid-flight (the batch's cron tick got
    // killed by Vercel before enrichLead finished) gets retried on the next
    // batch instead of being permanently stuck.
    enrichmentStatus: { in: ["pending", "failed", "unreachable", "crawling", "summarizing"] },
  };
}

/**
 * Kicks off enrichment for a run: marks it "enriching" and does one bounded
 * batch immediately (so there's no dead time waiting for the first cron
 * tick), same pattern as startCampaignScrape. Everything past that first
 * batch is driven by advanceAllInProgressEnrichments on the cron tick — a
 * run with 200+ pending leads used to enrich (website crawl + LLM analysis
 * + drafting) all of them inside one request, which reliably exceeded
 * Vercel's function execution limit and came back as a non-JSON timeout
 * page the client couldn't parse. Same class of bug already fixed for
 * scraping (advanceOneScrapeStep) and follow-up dispatch (runDueFollowups)
 * — this brings enrichment in line with the same incremental-step model.
 */
export async function enrichCampaignRun(campaignRunId: string): Promise<EnrichRunResult> {
  const attempted = await prisma.lead.count({ where: pendingEnrichmentWhere(campaignRunId) });

  if (attempted === 0) {
    return { attempted: 0 };
  }

  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: { status: "enriching" },
  });

  await advanceEnrichment(campaignRunId);

  return { attempted };
}

/** One bounded batch (CONCURRENCY leads) for a single run — safe to call repeatedly from a cron tick until nothing's left. */
export async function advanceEnrichment(campaignRunId: string): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: pendingEnrichmentWhere(campaignRunId),
    select: { id: true },
    take: CONCURRENCY,
  });

  if (leads.length === 0) {
    // updateMany (not update) since this filters on status too, not just
    // id — a plain update's where only accepts unique fields. Matches 0
    // rows harmlessly if another concurrent call already flipped it.
    await prisma.campaignRun.updateMany({
      where: { id: campaignRunId, status: "enriching" },
      data: { status: "ready" },
    });
    return;
  }

  await runWithConcurrency(leads, CONCURRENCY, async (lead) => {
    try {
      await enrichLead(lead.id);
    } catch (err) {
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
}

/** Advances every run currently "enriching" by one bounded batch. Called from GET /api/cron/tick. */
export async function advanceAllInProgressEnrichments(): Promise<void> {
  const runs = await prisma.campaignRun.findMany({
    where: { status: "enriching" },
    select: { id: true },
  });
  for (const run of runs) {
    try {
      await advanceEnrichment(run.id);
    } catch (err) {
      console.error(`[enrich ${run.id}] step failed`, err);
    }
  }
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
