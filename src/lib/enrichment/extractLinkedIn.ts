import * as cheerio from "cheerio";
import type { FetchedPage } from "@/lib/enrichment/crawler";

const LINKEDIN_LINK_RE = /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9\-_%]+\/?/i;

/** Scans all fetched pages for the first LinkedIn company/profile link. */
export function extractLinkedInUrl(pages: FetchedPage[]): string | null {
  for (const page of pages) {
    const $ = cheerio.load(page.html);
    let found: string | null = null;
    $("a[href]").each((_, el) => {
      if (found) return;
      const href = $(el).attr("href") ?? "";
      const match = href.match(LINKEDIN_LINK_RE);
      if (match) found = match[0];
    });
    if (found) return found;
  }
  return null;
}
