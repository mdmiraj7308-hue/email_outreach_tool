import type { BoundingBox } from "@/lib/geocoding";
import type { GeoJsonPolygon } from "@/lib/apify";

export type GridTile = BoundingBox;

/** Picks a near-square rows x cols layout that covers at least n tiles (e.g. 4 -> 2x2, 5 -> 3x2). */
export function pickGridDimensions(n: number): { rows: number; cols: number } {
  const rows = Math.max(1, Math.ceil(Math.sqrt(n)));
  const cols = Math.max(1, Math.ceil(n / rows));
  return { rows, cols };
}

/** Splits a bounding box into rows x cols equal-sized, non-overlapping tiles. */
export function splitIntoTiles(bbox: BoundingBox, rows: number, cols: number): GridTile[] {
  const latStep = (bbox.north - bbox.south) / rows;
  const lonStep = (bbox.east - bbox.west) / cols;
  const tiles: GridTile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        south: bbox.south + r * latStep,
        north: bbox.south + (r + 1) * latStep,
        west: bbox.west + c * lonStep,
        east: bbox.west + (c + 1) * lonStep,
      });
    }
  }
  return tiles;
}

/** Splits one tile into a finer 2x2 grid — used to dig into a tile whose result count suggests Google's ~120 cap hid more businesses. */
export function subdivideTile(tile: GridTile): GridTile[] {
  return splitIntoTiles(tile, 2, 2);
}

/** Converts a tile's bounding box into the closed-ring GeoJSON Polygon Apify's customGeolocation expects (longitude, latitude coordinate order, first point repeated last). */
export function tileToGeoJsonPolygon(tile: GridTile): GeoJsonPolygon {
  const { south, north, west, east } = tile;
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}
