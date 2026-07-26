import * as cheerio from "cheerio";
import { extractSpacedText, type FetchedPage } from "@/lib/enrichment/crawler";
import { isPlausibleEmail } from "@/lib/enrichment/emailFilters";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const FOUNDER_KEYWORDS = ["founder", "ceo", "owner", "president", "co-founder", "cofounder"];
const ANCESTOR_LEVELS = 4;
const TEXT_WINDOW_CHARS = 200;
// An ancestor container only counts as "the same card/section" as the
// mailto link if it's small — a shallow DOM (e.g. a whole ToS page wrapped
// in one <div>) would otherwise let an unrelated founder mention anywhere
// on the page falsely justify a generic contact email a few levels up.
const MAX_ANCESTOR_CONTEXT_CHARS = 600;

function containsFounderKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return FOUNDER_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Only returns an email that appears near founder/CEO/owner-indicating text
 * on About/Team/Contact-style pages — never constructs or guesses an email
 * from a name pattern.
 */
export function extractFounderEmail(pages: FetchedPage[]): string | null {
  for (const page of pages) {
    const $ = cheerio.load(page.html);

    // 1. mailto: links — check ancestor container text for founder keywords.
    let found: string | null = null;
    $("a[href^='mailto:']").each((_, el) => {
      if (found) return;
      const href = $(el).attr("href") ?? "";
      const raw = href.replace(/^mailto:/i, "").split("?")[0];
      let email: string;
      try {
        email = decodeURIComponent(raw).trim();
      } catch {
        email = raw.trim();
      }
      if (!email.includes("@") || !isPlausibleEmail(email)) return;

      let node = $(el);
      let context = "";
      for (let i = 0; i < ANCESTOR_LEVELS && node.length; i++) {
        context = node.text();
        if (context.length <= MAX_ANCESTOR_CONTEXT_CHARS && containsFounderKeyword(context)) {
          found = email;
          return;
        }
        node = node.parent();
      }
    });
    if (found) return found;

    // 2. Plain-text emails — check a text window around each match.
    $("script, style, nav, footer, noscript").remove();
    const bodyText = extractSpacedText($).replace(/\s+/g, " ");
    for (const match of bodyText.matchAll(EMAIL_RE)) {
      const email = match[0];
      if (!isPlausibleEmail(email)) continue;
      const idx = match.index ?? 0;
      const windowStart = Math.max(0, idx - TEXT_WINDOW_CHARS);
      const windowEnd = Math.min(bodyText.length, idx + email.length + TEXT_WINDOW_CHARS);
      const window = bodyText.slice(windowStart, windowEnd);
      if (containsFounderKeyword(window)) {
        return email;
      }
    }
  }
  return null;
}
