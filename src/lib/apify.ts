import { ApifyClient } from "apify-client";

const GOOGLE_MAPS_ACTOR_ID = "compass/crawler-google-places";

export interface GeoJsonPolygon {
  type: "Polygon";
  // [ [ [lng, lat], [lng, lat], ... , [lng, lat] ] ] — ring closed (first point repeated last).
  coordinates: number[][][];
}

export interface StartScrapeParams {
  apifyToken: string;
  searchQuery: string;
  maxLeads: number;
  // Exactly one of these two must be set. customGeolocation (an exact tile
  // polygon, used by the auto grid-search path) takes priority over
  // locationQuery per the actor's own precedence rule, so it's only sent
  // when present.
  location?: string;
  customGeolocation?: GeoJsonPolygon;
}

export async function startGoogleMapsScrape({
  apifyToken,
  searchQuery,
  location,
  customGeolocation,
  maxLeads,
}: StartScrapeParams): Promise<{ runId: string }> {
  const client = new ApifyClient({ token: apifyToken });
  const input: Record<string, unknown> = {
    searchStringsArray: [searchQuery],
    maxCrawledPlacesPerSearch: maxLeads,
    language: "en",
  };
  if (customGeolocation) {
    input.customGeolocation = customGeolocation;
  } else {
    input.locationQuery = location;
  }
  const run = await client.actor(GOOGLE_MAPS_ACTOR_ID).start(input);
  return { runId: run.id };
}

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTED"
  | "TIMED-OUT";

export async function getRunStatus(
  apifyToken: string,
  runId: string
): Promise<{ status: ApifyRunStatus; defaultDatasetId: string | null }> {
  const client = new ApifyClient({ token: apifyToken });
  const run = await client.run(runId).get();
  if (!run) {
    throw new Error(`Apify run ${runId} not found`);
  }
  return {
    status: run.status as ApifyRunStatus,
    defaultDatasetId: run.defaultDatasetId ?? null,
  };
}

export interface ScrapedPlace {
  businessName: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  category: string | null;
  // Google's stable per-business identifier — the reliable cross-run dedup
  // key (name/address can vary slightly between scrapes of the same place).
  placeId: string | null;
}

// Google Maps Scraper dataset items vary slightly across actor versions, so
// each field is read defensively across the known key aliases.
export async function fetchScrapedLeads(
  apifyToken: string,
  datasetId: string
): Promise<ScrapedPlace[]> {
  const client = new ApifyClient({ token: apifyToken });
  const { items } = await client.dataset(datasetId).listItems();

  return items.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      businessName: pickString(record, ["title", "name"]) ?? "Unknown business",
      website: pickString(record, ["website", "url"]),
      email: pickString(record, ["email", "emails.0"]),
      phone: pickString(record, ["phone", "phoneUnformatted", "phoneNumber"]),
      address: pickString(record, ["address", "street"]),
      category: pickString(record, ["categoryName", "category", "categories.0"]),
      placeId: pickString(record, ["placeId"]),
    };
  });
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = key.includes(".") ? getPath(record, key) : record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, record);
}
