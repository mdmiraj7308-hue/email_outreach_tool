import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { fetchScrapedLeads, getRunStatus, startGoogleMapsScrape } from "@/lib/apify";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { appendNoWebsiteLeadRows } from "@/lib/sheets";
import { nullify } from "@/lib/nullify";
import { geocodeBoundingBox } from "@/lib/geocoding";
import { pickGridDimensions, splitIntoTiles, subdivideTile, tileToGeoJsonPolygon, type GridTile } from "@/lib/geoGrid";
import {
  getAvailableApifyAccounts,
  getApifyAccountById,
  incrementLeadsScraped,
  deactivateApifyAccount,
  looksLikeQuotaError,
} from "@/lib/apifyAccounts";
import { format } from "date-fns";

// A single search+location combo on Google Maps returns at most ~120
// results no matter how many businesses actually exist there. These
// constants drive the auto grid-search path: how many leads we plan for
// per tile, how many we actually ask Apify for per tile, and when a tile's
// result count is high enough that we suspect real coverage was cut off by
// that cap and it's worth searching a finer subdivision of it.
const TARGET_PER_TILE = 100;
const TILE_REQUEST_CAP = 120;
const SATURATION_THRESHOLD = 110;
const MAX_SUBDIVISION_DEPTH = 2;
const MAX_TOTAL_TILES = 25;

export interface StartCampaignParams {
  searchQuery: string;
  location: string;
  maxLeads: number;
  preferredService?: string;
  additionalLocations?: string[];
  autoGrid?: boolean;
}

type QueueItem =
  | { kind: "location"; location: string }
  | { kind: "tile"; tile: GridTile; depth: number };

/**
 * Persisted orchestration state (JSON-serialized onto CampaignRun.scrapeQueue)
 * so a multi-location/tile scrape survives across many small steps instead
 * of needing one long-lived background process. Vercel serverless functions
 * get frozen shortly after their response is sent — even `after()`/waitUntil
 * only reliably buys a few seconds, nowhere near the minutes a real
 * multi-tile grid search can take — so each step here does at most one
 * quick action (start one Apify run, or check one Apify run's status once)
 * and returns; `/api/cron/tick` calls advanceOneScrapeStep once per minute
 * until the queue is empty.
 */
interface ScrapeState {
  searchQuery: string;
  perItemMaxLeads: number;
  totalLeadsTarget: number;
  isAutoGrid: boolean;
  queue: QueueItem[];
  currentItem: QueueItem | null;
  excludeAccountIds: string[];
  tilesProcessed: number;
  duplicatesSkipped: number;
}

export async function startCampaignScrape(params: StartCampaignParams) {
  const settings = await getSettings();
  const initialAccounts = await getAvailableApifyAccounts();
  if (initialAccounts.length === 0) {
    throw new Error("No Apify accounts with remaining capacity are configured in Settings.");
  }

  const maxLeads = Math.min(params.maxLeads, settings.globalScrapeLimit);
  const manualLocations = dedupeLocations(params.additionalLocations ?? []);
  const useAutoGrid = params.autoGrid && manualLocations.length === 0 && maxLeads > TARGET_PER_TILE;
  const locations = dedupeLocations([params.location, ...manualLocations]);

  const label =
    locations.length > 1
      ? `${format(new Date(), "yyyy-MM-dd")} — ${params.searchQuery} in ${params.location} (+${locations.length - 1} more area${locations.length - 1 === 1 ? "" : "s"})`
      : `${format(new Date(), "yyyy-MM-dd")} — ${params.searchQuery} in ${params.location}`;

  let queue: QueueItem[];
  let perItemMaxLeads: number;

  if (useAutoGrid) {
    const bbox = await geocodeBoundingBox(params.location);
    if (bbox) {
      const variantCount = Math.max(1, Math.ceil(maxLeads / TARGET_PER_TILE));
      const { rows, cols } = pickGridDimensions(variantCount);
      queue = splitIntoTiles(bbox, rows, cols).map((tile) => ({ kind: "tile", tile, depth: 0 }));
      perItemMaxLeads = TILE_REQUEST_CAP;
    } else {
      // Couldn't geocode — fall back to a plain single search rather than
      // failing the whole campaign over a lookup that isn't essential.
      console.error(`[scrape] geocoding failed for "${params.location}", falling back to plain search`);
      queue = [{ kind: "location", location: params.location }];
      perItemMaxLeads = maxLeads;
    }
  } else {
    queue = locations.map((location) => ({ kind: "location", location }));
    perItemMaxLeads = maxLeads;
  }

  const state: ScrapeState = {
    searchQuery: params.searchQuery,
    perItemMaxLeads,
    totalLeadsTarget: maxLeads,
    isAutoGrid: useAutoGrid ?? false,
    queue,
    currentItem: null,
    excludeAccountIds: [],
    tilesProcessed: 0,
    duplicatesSkipped: 0,
  };

  const run = await prisma.campaignRun.create({
    data: {
      label,
      searchQuery: params.searchQuery,
      location: params.location,
      maxLeads,
      status: "scraping",
      preferredService: nullify(params.preferredService ?? null),
      scrapeQueue: JSON.stringify(state),
    },
  });

  // Kick off the first Apify run immediately (a single fast "start" API call,
  // not a poll) so there's no dead time waiting for the first cron tick.
  // Every subsequent step happens via advanceOneScrapeStep on the cron.
  await advanceOneScrapeStep(run.id);

  return run;
}

function dedupeLocations(locations: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const loc of locations) {
    const trimmed = loc.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/** Advances every in-progress scrape by exactly one step. Called from GET /api/cron/tick. */
export async function advanceInProgressScrapes(): Promise<void> {
  const runs = await prisma.campaignRun.findMany({
    where: { status: "scraping" },
    select: { id: true },
  });
  for (const run of runs) {
    try {
      await advanceOneScrapeStep(run.id);
    } catch (err) {
      console.error(`[scrape ${run.id}] step failed`, err);
    }
  }
}

/**
 * Does at most one quick thing: either checks the currently in-flight Apify
 * run's status once (never loops/sleeps), or — if nothing's in flight —
 * starts the next queued item. Safe to call repeatedly; a no-op once the
 * run is no longer "scraping".
 */
export async function advanceOneScrapeStep(campaignRunId: string): Promise<void> {
  const run = await prisma.campaignRun.findUnique({ where: { id: campaignRunId } });
  if (!run || run.status !== "scraping") return;

  const state = parseState(run.scrapeQueue);
  if (!state) {
    await prisma.campaignRun.update({ where: { id: campaignRunId }, data: { status: "failed" } });
    return;
  }

  if (run.apifyRunId && run.scrapeAccountId) {
    await checkInFlightRun(campaignRunId, run.apifyRunId, run.scrapeAccountId, state);
    return;
  }

  await startNextQueueItem(campaignRunId, state);
}

async function checkInFlightRun(
  campaignRunId: string,
  apifyRunId: string,
  accountId: string,
  state: ScrapeState
): Promise<void> {
  const account = await getApifyAccountById(accountId);
  if (!account) {
    await finishCurrentItem(campaignRunId, state, 0);
    return;
  }

  let status;
  try {
    status = await getRunStatus(account.token, apifyRunId);
  } catch (err) {
    console.error(`[scrape ${campaignRunId}] failed to poll Apify run ${apifyRunId}`, err);
    return; // transient — try again next tick, leave everything as-is
  }

  if (status.status === "RUNNING" || status.status === "READY") return; // still going

  if (status.status === "SUCCEEDED" && status.defaultDatasetId) {
    let duplicatesSkipped: number;
    let rawCount: number;
    let newRecordsCount: number;
    try {
      ({ duplicatesSkipped, rawCount, newRecordsCount } = await insertLeadsFromDataset(
        campaignRunId,
        account.token,
        status.defaultDatasetId
      ));
    } catch (err) {
      // Without this, a failure here (Prisma hiccup, Apify dataset-read
      // error, anything) would leave apifyRunId/scrapeAccountId un-cleared
      // forever — every subsequent tick re-enters this same branch and
      // retries the exact same dataset indefinitely. Treat it like a
      // failed tile instead: log, move on to whatever's next.
      console.error(`[scrape ${campaignRunId}] failed to insert leads from dataset ${status.defaultDatasetId}`, err);
      await finishCurrentItem(campaignRunId, state, 0);
      return;
    }
    // newRecordsCount reflects rows actually written to the DB, so it
    // always reconciles cleanly with the actual Lead + NoWebsiteLead counts
    // you see in the UI, and can't drift even on a retried/overlapping tick.
    await incrementLeadsScraped(account.id, newRecordsCount);
    await finishCurrentItem(campaignRunId, state, duplicatesSkipped, rawCount);
  } else {
    console.error(`[scrape ${campaignRunId}] Apify run ${apifyRunId} ended as ${status.status}`);
    await finishCurrentItem(campaignRunId, state, 0);
  }
}

/** Records the outcome of state.currentItem, queues any adaptive subdivisions, clears the in-flight pointer, and persists — the next tick will start whatever's next. */
async function finishCurrentItem(
  campaignRunId: string,
  state: ScrapeState,
  duplicatesSkipped: number,
  rawCount = 0
): Promise<void> {
  const item = state.currentItem;
  state.currentItem = null;
  state.duplicatesSkipped += duplicatesSkipped;

  if (item?.kind === "tile" && rawCount >= SATURATION_THRESHOLD && item.depth < MAX_SUBDIVISION_DEPTH) {
    for (const sub of subdivideTile(item.tile)) {
      state.queue.push({ kind: "tile", tile: sub, depth: item.depth + 1 });
    }
  }

  if (state.queue.length === 0) {
    await finalizeCampaignRun(campaignRunId, state);
    return;
  }

  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: { apifyRunId: null, scrapeAccountId: null, scrapeQueue: JSON.stringify(state) },
  });
}

async function startNextQueueItem(campaignRunId: string, state: ScrapeState): Promise<void> {
  if (state.isAutoGrid) {
    const currentTotal = await prisma.lead.count({ where: { campaignRunId } });
    if (currentTotal >= state.totalLeadsTarget) {
      await finalizeCampaignRun(campaignRunId, state);
      return;
    }
  }

  if (state.queue.length === 0 || state.tilesProcessed >= MAX_TOTAL_TILES) {
    await finalizeCampaignRun(campaignRunId, state);
    return;
  }

  const item = state.queue.shift()!;
  state.currentItem = item;
  state.tilesProcessed += 1;

  const excludeIds = new Set(state.excludeAccountIds);
  let started;
  try {
    started = await startScrapeWithRotation(
      campaignRunId,
      state.searchQuery,
      item,
      state.perItemMaxLeads,
      excludeIds
    );
  } catch (err) {
    console.error(`[scrape ${campaignRunId}] failed to start item`, err);
    // No accounts left / hard failure — drop this item and let the next
    // tick try whatever's still queued rather than getting stuck forever.
    state.currentItem = null;
    state.excludeAccountIds = [...excludeIds];
    if (state.queue.length === 0) {
      await finalizeCampaignRun(campaignRunId, state);
    } else {
      await prisma.campaignRun.update({
        where: { id: campaignRunId },
        data: { apifyRunId: null, scrapeAccountId: null, scrapeQueue: JSON.stringify(state) },
      });
    }
    return;
  }

  state.excludeAccountIds = [...excludeIds];
  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: {
      apifyRunId: started.runId,
      scrapeAccountId: started.accountId,
      scrapeQueue: JSON.stringify(state),
    },
  });
}

async function finalizeCampaignRun(campaignRunId: string, state: ScrapeState): Promise<void> {
  const leadCount = await prisma.lead.count({ where: { campaignRunId } });
  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: {
      status: leadCount > 0 ? "scraped" : "failed",
      duplicatesSkipped: state.duplicatesSkipped,
      apifyRunId: null,
      scrapeAccountId: null,
      scrapeQueue: null,
    },
  });
}

/**
 * Starts a Google Maps scrape for one queue item, rotating through available
 * Apify accounts (oldest/least-drained first) if the start call fails with a
 * quota/plan-limit-looking error. `excludeIds` accumulates across the whole
 * campaign run so an account confirmed exhausted is never retried for any
 * later item either.
 */
async function startScrapeWithRotation(
  campaignRunId: string,
  searchQuery: string,
  item: QueueItem,
  maxLeads: number,
  excludeIds: Set<string>
): Promise<{ runId: string; accountId: string }> {
  const accounts = await getAvailableApifyAccounts(excludeIds);
  if (accounts.length === 0) {
    throw new Error("No Apify accounts with remaining capacity");
  }
  const account = accounts[0];

  try {
    const { runId } =
      item.kind === "location"
        ? await startGoogleMapsScrape({ apifyToken: account.token, searchQuery, location: item.location, maxLeads })
        : await startGoogleMapsScrape({
            apifyToken: account.token,
            searchQuery,
            customGeolocation: tileToGeoJsonPolygon(item.tile),
            maxLeads,
          });
    return { runId, accountId: account.id };
  } catch (err) {
    if (!looksLikeQuotaError(err)) throw err;
    console.error(
      `[scrape ${campaignRunId}] Apify account ${account.id} looks exhausted (${
        err instanceof Error ? err.message : String(err)
      }), rotating to next account`
    );
    await deactivateApifyAccount(account.id);
    excludeIds.add(account.id);
    return startScrapeWithRotation(campaignRunId, searchQuery, item, maxLeads, excludeIds);
  }
}

async function insertLeadsFromDataset(
  campaignRunId: string,
  apifyToken: string,
  datasetId: string
): Promise<{ duplicatesSkipped: number; rawCount: number; newRecordsCount: number }> {
  const places = await fetchScrapedLeads(apifyToken, datasetId);

  const placeIds = places.map((p) => p.placeId).filter((id): id is string => !!id);
  const existingPlaceIds = new Set(
    placeIds.length > 0
      ? (
          await Promise.all([
            prisma.lead.findMany({
              where: { googlePlaceId: { in: placeIds } },
              select: { googlePlaceId: true },
            }),
            prisma.noWebsiteLead.findMany({
              where: { googlePlaceId: { in: placeIds } },
              select: { googlePlaceId: true },
            }),
          ])
        )
          .flat()
          .map((l) => l.googlePlaceId)
      : []
  );

  const newPlaces = places.filter((p) => !p.placeId || !existingPlaceIds.has(p.placeId));

  // Businesses with no real website (a Google Maps listing url doesn't
  // count) have nothing for the enrichment/drafting pipeline to work with,
  // so they never become a Lead row at all — routed straight to the
  // dedicated "No Website Leads" sheet tab instead.
  const withWebsite = newPlaces.filter((p) => p.website);
  const withoutWebsite = newPlaces.filter((p) => !p.website);

  // A single-tile dataset can be 100+ places (TILE_REQUEST_CAP=120) — an
  // array-form $transaction([...]) of that many individual create() calls
  // defaults to a 5s interactive-transaction timeout and reliably blew past
  // it talking to Supabase from Vercel (confirmed in production: "A
  // rollback cannot be executed on an expired transaction"), silently
  // dropping the whole batch even though Apify itself had already
  // succeeded. createManyAndReturn is a single bulk INSERT — one round
  // trip, no per-row transaction overhead. skipDuplicates guards against
  // the rare case of the same place appearing twice within one dataset
  // (not just against leads already in the DB, which newPlaces already
  // filtered for).
  const leads =
    withWebsite.length > 0
      ? await prisma.lead.createManyAndReturn({
          data: withWebsite.map((place) => ({
            campaignRunId,
            googlePlaceId: place.placeId,
            businessName: place.businessName,
            website: nullify(place.website),
            category: nullify(place.category),
            scrapedEmail: nullify(place.email),
            primaryEmail: nullify(place.email),
            phone: nullify(place.phone),
            address: nullify(place.address),
            leadType: "standard",
          })),
          skipDuplicates: true,
        })
      : [];

  for (const lead of leads) {
    await syncLeadToSheet(lead.id);
  }

  const noWebsiteRecords =
    withoutWebsite.length > 0
      ? await prisma.noWebsiteLead.createManyAndReturn({
          data: withoutWebsite.map((place) => ({
            campaignRunId,
            googlePlaceId: place.placeId,
            businessName: place.businessName,
            phone: nullify(place.phone),
            address: nullify(place.address),
            category: nullify(place.category),
            googleMapsUrl: nullify(place.mapsUrl),
          })),
          skipDuplicates: true,
        })
      : [];
  if (noWebsiteRecords.length > 0) {
    await pushNoWebsiteLeadsToSheet(noWebsiteRecords);
  }

  // Counted from what was actually written to the DB (leads.length +
  // noWebsiteRecords.length), not from places.length minus the pre-insert
  // duplicate check — that subtraction overcounted whenever `skipDuplicates`
  // silently dropped a row the pre-check didn't catch (e.g. the same place
  // appearing twice within one Apify dataset, or two overlapping cron ticks
  // racing on the same dataset), so it drifted from the real Lead +
  // NoWebsiteLead counts. Deriving from the actual insert results can never
  // overcount, by construction.
  const newRecordsCount = leads.length + noWebsiteRecords.length;
  return { duplicatesSkipped: places.length - newRecordsCount, rawCount: places.length, newRecordsCount };
}

async function pushNoWebsiteLeadsToSheet(
  records: { businessName: string; phone: string; address: string; category: string; googleMapsUrl: string; createdAt: Date }[]
): Promise<void> {
  const settings = await getSettings();
  if (!settings.googleServiceAccountJson || !settings.googleSheetId) return;

  try {
    await appendNoWebsiteLeadRows(
      settings.googleServiceAccountJson,
      settings.googleSheetId,
      records.map((r) => ({
        date: format(r.createdAt, "yyyy-MM-dd"),
        businessName: r.businessName,
        phone: r.phone,
        address: r.address,
        category: r.category,
        googleMapsUrl: r.googleMapsUrl,
      }))
    );
  } catch (err) {
    console.error("[scrape] failed to push no-website leads to sheet", err);
  }
}

function parseState(raw: string | null): ScrapeState | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScrapeState;
  } catch {
    return null;
  }
}
