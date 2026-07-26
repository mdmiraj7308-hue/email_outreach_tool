export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * Free, no-key geocoding lookup (OpenStreetMap Nominatim) used only to get a
 * location's outer bounding box for grid-splitting a large search area into
 * non-overlapping tiles. Called at most once per auto-grid campaign, well
 * within Nominatim's public-instance usage policy (a valid User-Agent, no
 * more than ~1 request/second).
 */
export async function geocodeBoundingBox(location: string): Promise<BoundingBox | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "EmailOutreachTool/1.0 (local single-user tool)" },
    });
    if (!res.ok) return null;
    const results = (await res.json()) as Array<{
      boundingbox?: [string, string, string, string];
    }>;
    const box = results[0]?.boundingbox;
    if (!box) return null;
    const [south, north, west, east] = box.map(Number);
    if ([south, north, west, east].some((n) => Number.isNaN(n))) return null;
    return { south, north, west, east };
  } catch {
    return null;
  }
}
