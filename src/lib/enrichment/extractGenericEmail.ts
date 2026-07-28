import * as cheerio from "cheerio";
import { extractSpacedText, type FetchedPage } from "@/lib/enrichment/crawler";
import { isPlausibleEmail } from "@/lib/enrichment/emailFilters";
import { emailMatchesSite, extractJsonLdEmails } from "@/lib/enrichment/extractStructuredEmail";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function decodeMailto(href: string): string {
  const raw = href.replace(/^mailto:/i, "").split("?")[0];
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/**
 * Falls back to any published email on the site (mailto link, schema.org
 * JSON-LD, or plain text) when no founder/CEO-tagged email was found. Still
 * a real, on-site contact address — just not tied to a named individual, so
 * outreach to it reads less personal but is still a legitimate target (e.g.
 * info@, contact@, hello@ inboxes that a real person reads).
 *
 * Scans every crawled page (not just the first one with any match) and
 * prefers a candidate whose domain matches the site itself — a mailto typo
 * (seen in practice: an <a href="mailto:info@maslowealth.com"> pointing at a
 * misspelled domain, sitting right next to the correct address in the
 * page's own JSON-LD data) shouldn't win over a same-domain address found
 * elsewhere on the site.
 */
export function extractGenericEmail(pages: FetchedPage[], siteHostname?: string): string | null {
  const candidates: string[] = [];

  for (const page of pages) {
    const $ = cheerio.load(page.html);

    $("a[href^='mailto:']").each((_, el) => {
      const email = decodeMailto($(el).attr("href") ?? "");
      if (email.includes("@") && isPlausibleEmail(email)) candidates.push(email);
    });

    candidates.push(...extractJsonLdEmails($));

    // Deliberately NOT stripping nav/footer here (unlike extractCleanText,
    // which strips them for LLM-summary purposes) — the footer is one of
    // the most common places a business publishes its contact email as
    // plain text rather than a mailto link (confirmed in practice: e.g.
    // "info@contigoagency.com" sitting in a <footer><li> with no <a> tag
    // at all), so removing it before this scan was silently dropping real,
    // legitimate contact addresses.
    $("script, style, noscript").remove();
    const bodyText = extractSpacedText($);
    for (const match of bodyText.matchAll(EMAIL_RE)) {
      if (isPlausibleEmail(match[0])) candidates.push(match[0]);
    }
  }

  if (candidates.length === 0) return null;

  if (siteHostname) {
    const onSite = candidates.find((email) => emailMatchesSite(email, siteHostname));
    if (onSite) return onSite;
  }

  return candidates[0];
}
