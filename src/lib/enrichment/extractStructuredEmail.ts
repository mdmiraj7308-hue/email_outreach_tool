import * as cheerio from "cheerio";
import { isPlausibleEmail } from "@/lib/enrichment/emailFilters";

/**
 * Emails published in schema.org JSON-LD blocks (Organization/LocalBusiness
 * "email" field). This is hand-maintained structured data separate from the
 * visible page markup, so it's a useful second source when a visible mailto
 * link is missing, obfuscated, or contains a typo (seen in practice: a site
 * with a correct JSON-LD email but a mailto link pointing at a misspelled
 * domain).
 */
export function extractJsonLdEmails($: cheerio.CheerioAPI): string[] {
  const found: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    let data: unknown;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    collectEmails(data, found);
  });
  return found.filter(isPlausibleEmail);
}

function collectEmails(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectEmails(item, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.toLowerCase() === "email" && typeof value === "string" && value.includes("@")) {
        out.push(value.trim());
      } else {
        collectEmails(value, out);
      }
    }
  }
}

/** True when an email's domain matches (or is a subdomain of) the site it was found on — the strongest signal that it's the business's real address rather than a typo or an unrelated third-party contact. */
export function emailMatchesSite(email: string, siteHostname: string): boolean {
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain) return false;
  const site = siteHostname.replace(/^www\./i, "").toLowerCase();
  return emailDomain === site || emailDomain.endsWith(`.${site}`) || site.endsWith(`.${emailDomain}`);
}
