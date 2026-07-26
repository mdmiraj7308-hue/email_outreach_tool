import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { fetchScrapedLeads, getRunStatus, startGoogleMapsScrape, type StartScrapeParams } from "@/lib/apify";
import { syncLeadToSheet } from "@/lib/leadSheetSync";
import { nullify } from "@/lib/nullify";
import { geocodeBoundingBox } from "@/lib/geocoding";
import { pickGridDimensions, splitIntoTiles, subdivideTile, tileToGeoJsonPolygon, type GridTile } from "@/lib/geoGrid";
import {
  getAvailableApifyAccounts,
  incrementLeadsScraped,
  deactivateApifyAccount,
  looksLikeQuotaError,
} from "@/lib/apifyAccounts";
import { format } from "date-fns";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

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
  // Extra location strings (e.g. individual zip codes or neighborhoods)
  // searched in addition to `location`, each as its own Apify run. Mutually
  // exclusive with autoGrid — an explicit list means the user wants precise
  // control over which areas get searched.
  additionalLocations?: string[];
  // When true (and additionalLocations is empty), automatically fragments
  // `location` into a grid of non-overlapping map tiles sized to reach
  // maxLeads, searching only as many as needed (adaptively subdividing any
  // tile that looks saturated) rather than requiring the user to know or
  // type specific zip codes themselves.
  autoGrid?: boolean;
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

  const run = await prisma.campaignRun.create({
    data: {
      label,
      searchQuery: params.searchQuery,
      location: params.location,
      maxLeads,
      status: "scraping",
      preferredService: nullify(params.preferredService ?? null),
    },
  });

  // `after()` (not a bare fire-and-forget `void` call) so this keeps running
  // on Vercel once the response is sent — a plain unawaited promise gets cut
  // off there as soon as the request completes, since serverless functions
  // don't stay alive for background work the way a local `npm run dev`
  // process does. Locally this behaves the same as before.
  if (useAutoGrid) {
    after(() => runAdaptiveGridScrape(run.id, params.searchQuery, params.location, maxLeads));
  } else {
    after(() => runLocationGrid(run.id, params.searchQuery, locations, maxLeads));
  }

  return run;
}

/**
 * Starts a Google Maps scrape, rotating through available Apify accounts
 * (oldest/least-drained first) if the current one's start call fails with a
 * quota/plan-limit-looking error. `excludeIds` is shared across an entire
 * scrape run so an account confirmed exhausted on one tile/location is never
 * retried for the rest of that run either. Only the START call rotates —
 * once a run has actually started under an account, polling/fetching its
 * dataset must stick with that same account's token.
 */
async function startScrapeWithRotation(
  campaignRunId: string,
  params: Omit<StartScrapeParams, "apifyToken">,
  excludeIds: Set<string>
): Promise<{ runId: string; accountId: string; token: string }> {
  const accounts = await getAvailableApifyAccounts(excludeIds);
  if (accounts.length === 0) {
    throw new Error("No Apify accounts with remaining capacity");
  }
  const account = accounts[0];

  try {
    const { runId } = await startGoogleMapsScrape({ ...params, apifyToken: account.token });
    return { runId, accountId: account.id, token: account.token };
  } catch (err) {
    if (!looksLikeQuotaError(err)) throw err;
    console.error(
      `[scrape ${campaignRunId}] Apify account ${account.id} looks exhausted (${
        err instanceof Error ? err.message : String(err)
      }), rotating to next account`
    );
    await deactivateApifyAccount(account.id);
    excludeIds.add(account.id);
    return startScrapeWithRotation(campaignRunId, params, excludeIds);
  }
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

/**
 * Runs one Apify actor invocation per location, sequentially (Apify calls
 * cost run-time/usage, so parallel doesn't help and would just make
 * partial-failure bookkeeping messier), accumulating leads and
 * duplicate-skip counts across all of them before marking the run done.
 * A failure on one location doesn't abort the others — partial coverage
 * beats none.
 */
async function runLocationGrid(
  campaignRunId: string,
  searchQuery: string,
  locations: string[],
  maxLeads: number
) {
  let totalDuplicatesSkipped = 0;
  let anySucceeded = false;
  const excludeIds = new Set<string>();

  for (const location of locations) {
    try {
      const { runId: apifyRunId, accountId, token } = await startScrapeWithRotation(
        campaignRunId,
        { searchQuery, location, maxLeads },
        excludeIds
      );
      await prisma.campaignRun.update({ where: { id: campaignRunId }, data: { apifyRunId } });

      const datasetId = await pollUntilFinished(campaignRunId, apifyRunId, token);
      if (!datasetId) continue; // failed or timed out — move on to the next location

      const { duplicatesSkipped, rawCount } = await insertLeadsFromDataset(
        campaignRunId,
        token,
        datasetId
      );
      await incrementLeadsScraped(accountId, rawCount);
      totalDuplicatesSkipped += duplicatesSkipped;
      anySucceeded = true;
    } catch (err) {
      console.error(`[scrape ${campaignRunId}] location "${location}" failed`, err);
    }
  }

  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: {
      status: anySucceeded ? "scraped" : "failed",
      duplicatesSkipped: totalDuplicatesSkipped,
    },
  });
}

interface QueuedTile {
  tile: GridTile;
  depth: number;
}

/**
 * Auto grid-search: geocodes `location` into its map bounding box, splits
 * it into just enough tiles to plausibly reach maxLeads, and searches each
 * tile with an exact polygon (customGeolocation) instead of a free-text
 * location — guaranteeing non-overlapping search areas by construction
 * rather than hoping zip-code boundaries don't overlap. Adaptive: a tile
 * whose result count lands at/near Google's ~120 cap gets subdivided into a
 * finer 2x2 and re-searched (up to MAX_SUBDIVISION_DEPTH), since a
 * saturated result set is a sign real coverage was cut off. Stops early
 * once total unique leads reach maxLeads — maxLeads is a floor to search
 * until, not a hard per-tile cap.
 */
async function runAdaptiveGridScrape(
  campaignRunId: string,
  searchQuery: string,
  location: string,
  maxLeads: number
) {
  const bbox = await geocodeBoundingBox(location);
  if (!bbox) {
    // Couldn't geocode — fall back to a plain single search rather than
    // failing the whole campaign over a lookup that isn't essential.
    console.error(`[scrape ${campaignRunId}] geocoding failed for "${location}", falling back to plain search`);
    await runLocationGrid(campaignRunId, searchQuery, [location], maxLeads);
    return;
  }

  const variantCount = Math.max(1, Math.ceil(maxLeads / TARGET_PER_TILE));
  const { rows, cols } = pickGridDimensions(variantCount);
  const queue: QueuedTile[] = splitIntoTiles(bbox, rows, cols).map((tile) => ({ tile, depth: 0 }));

  let totalDuplicatesSkipped = 0;
  let tilesProcessed = 0;
  let anySucceeded = false;
  const excludeIds = new Set<string>();

  while (queue.length > 0 && tilesProcessed < MAX_TOTAL_TILES) {
    const currentTotal = await prisma.lead.count({ where: { campaignRunId } });
    if (currentTotal >= maxLeads) break; // floor reached — stop searching further tiles

    const next = queue.shift();
    if (!next) break;
    const { tile, depth } = next;
    tilesProcessed++;

    try {
      const { runId: apifyRunId, accountId, token } = await startScrapeWithRotation(
        campaignRunId,
        { searchQuery, customGeolocation: tileToGeoJsonPolygon(tile), maxLeads: TILE_REQUEST_CAP },
        excludeIds
      );
      await prisma.campaignRun.update({ where: { id: campaignRunId }, data: { apifyRunId } });

      const datasetId = await pollUntilFinished(campaignRunId, apifyRunId, token);
      if (!datasetId) continue;

      const { duplicatesSkipped, rawCount } = await insertLeadsFromDataset(
        campaignRunId,
        token,
        datasetId
      );
      await incrementLeadsScraped(accountId, rawCount);
      totalDuplicatesSkipped += duplicatesSkipped;
      anySucceeded = true;

      if (rawCount >= SATURATION_THRESHOLD && depth < MAX_SUBDIVISION_DEPTH) {
        for (const sub of subdivideTile(tile)) queue.push({ tile: sub, depth: depth + 1 });
      }
    } catch (err) {
      console.error(`[scrape ${campaignRunId}] grid tile failed`, err);
    }
  }

  await prisma.campaignRun.update({
    where: { id: campaignRunId },
    data: {
      status: anySucceeded ? "scraped" : "failed",
      duplicatesSkipped: totalDuplicatesSkipped,
    },
  });
}

/** Polls a single Apify run to completion; returns its dataset id, or null on failure/timeout. */
async function pollUntilFinished(
  campaignRunId: string,
  apifyRunId: string,
  apifyToken: string
): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let status;
    try {
      status = await getRunStatus(apifyToken, apifyRunId);
    } catch (err) {
      console.error(`[scrape ${campaignRunId}] failed to poll Apify run ${apifyRunId}`, err);
      continue;
    }

    if (status.status === "RUNNING" || status.status === "READY") continue;
    if (status.status !== "SUCCEEDED" || !status.defaultDatasetId) return null;
    return status.defaultDatasetId;
  }

  console.error(`[scrape ${campaignRunId}] timed out waiting for Apify run ${apifyRunId}`);
  return null;
}

async function insertLeadsFromDataset(
  campaignRunId: string,
  apifyToken: string,
  datasetId: string
): Promise<{ duplicatesSkipped: number; rawCount: number }> {
  const places = await fetchScrapedLeads(apifyToken, datasetId);

  // Cross-run AND cross-location dedup: skip any place whose Google Place ID
  // already exists as a Lead (from a prior scrape, or from an earlier
  // location/tile in this same grid search), rather than creating a second row.
  const placeIds = places.map((p) => p.placeId).filter((id): id is string => !!id);
  const existingPlaceIds = new Set(
    placeIds.length > 0
      ? (
          await prisma.lead.findMany({
            where: { googlePlaceId: { in: placeIds } },
            select: { googlePlaceId: true },
          })
        ).map((l) => l.googlePlaceId)
      : []
  );

  const newPlaces = places.filter((p) => !p.placeId || !existingPlaceIds.has(p.placeId));
  const duplicatesSkipped = places.length - newPlaces.length;

  const leads = await prisma.$transaction(
    newPlaces.map((place) =>
      prisma.lead.create({
        data: {
          campaignRunId,
          googlePlaceId: place.placeId,
          businessName: place.businessName,
          website: nullify(place.website),
          category: nullify(place.category),
          scrapedEmail: nullify(place.email),
          primaryEmail: nullify(place.email),
          phone: nullify(place.phone),
          address: nullify(place.address),
          // Determined for real during enrichment (that's where we
          // actually confirm no site is reachable), but set here too so a
          // lead is correctly typed even if enrichment is never run.
          leadType: place.website ? "standard" : "no_website",
        },
      })
    )
  );

  for (const lead of leads) {
    await syncLeadToSheet(lead.id);
  }

  return { duplicatesSkipped, rawCount: places.length };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
