import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchRenderedHtml, getSharedBrowser, looksBlocked } from "@/lib/enrichment/headlessFetch";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGES = 5;
const PAGE_LINK_KEYWORDS = [
  "about",
  "team",
  "service",
  "pricing",
  "contact",
  "get-started",
  "get started",
  "connect",
];

export interface FetchedPage {
  url: string;
  html: string;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EmailOutreachToolBot/1.0)" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Minimal robots.txt check: returns false only if the root path is
 * explicitly disallowed for all user agents ("User-agent: *" + "Disallow: /").
 * Anything else (missing robots.txt, partial disallow, fetch failure) is
 * treated as allowed — this is a courtesy check, not a full parser.
 */
export async function isCrawlingAllowed(origin: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`);
    if (!res.ok) return true;
    const text = await res.text();

    const lines = text.split("\n").map((l) => l.trim());
    let applyingToAll = false;
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith("user-agent:")) {
        applyingToAll = lower.includes("*");
        continue;
      }
      if (applyingToAll && lower.startsWith("disallow:")) {
        const path = line.split(":")[1]?.trim();
        if (path === "/") return false;
      }
    }
    return true;
  } catch {
    return true;
  }
}

function normalizeInternalLink(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function discoverRelevantLinks($: cheerio.CheerioAPI, origin: string): string[] {
  const found = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().toLowerCase();
    if (!href) return;
    const matches = PAGE_LINK_KEYWORDS.some(
      (kw) => href.toLowerCase().includes(kw) || text.includes(kw)
    );
    if (!matches) return;
    const normalized = normalizeInternalLink(href, origin);
    if (normalized) found.add(normalized);
  });
  return [...found];
}

interface PageFetchResult {
  html: string;
  /** True for a normal successful response (2xx, not a bot-wall page). */
  ok: boolean;
  /** True when the plain fetch (or the headless retry) hit a Cloudflare-style challenge/WAF block. */
  blocked: boolean;
}

/**
 * Fetches a URL with the plain lightweight path first; if that comes back
 * looking like a bot-wall block (Cloudflare-style JS challenge, WAF 403),
 * retries once with a real headless browser that can pass the challenge.
 * The headless path is much slower, so it's only ever a fallback.
 */
async function fetchPageHtml(url: string): Promise<PageFetchResult> {
  let plainHtml = "";
  let plainStatus = 0;
  try {
    const res = await fetchWithTimeout(url);
    plainStatus = res.status;
    plainHtml = await res.text();
    if (!looksBlocked(plainStatus, plainHtml)) {
      return { html: plainHtml, ok: res.ok, blocked: false };
    }
  } catch {
    // fall through to the headless retry below
  }

  try {
    const browser = await getSharedBrowser();
    const html = await fetchRenderedHtml(browser, url);
    return { html, ok: true, blocked: false };
  } catch {
    return { html: plainHtml, ok: false, blocked: true };
  }
}

/**
 * Fetches the homepage plus up to a handful of About/Team/Service/Pricing/
 * Contact pages. Each fetch is independently try/caught so one broken page
 * never aborts the whole crawl.
 */
export async function crawlWebsite(websiteUrl: string): Promise<FetchedPage[]> {
  const homepageUrl = new URL(websiteUrl).toString();
  const origin = new URL(websiteUrl).origin;

  const pages: FetchedPage[] = [];

  const homepage = await fetchPageHtml(homepageUrl);
  if (!homepage.html) {
    throw new Error("Failed to fetch homepage");
  }
  pages.push({ url: homepageUrl, html: homepage.html });

  const $ = cheerio.load(homepage.html);
  const links = discoverRelevantLinks($, origin).filter((l) => l !== homepageUrl);

  for (const link of links.slice(0, MAX_PAGES - 1)) {
    const page = await fetchPageHtml(link);
    if (page.ok) pages.push({ url: link, html: page.html });
  }

  return pages;
}

/**
 * cheerio's `.text()` naively concatenates every descendant text node with
 * no separator — a label and its value sitting in adjacent elements with no
 * literal whitespace between them in the source HTML (e.g. a "Email" label
 * `<p>` next to an `<p>Info@site.com</p>` value, common in icon+label+value
 * contact widgets) come out jammed together as "EmailInfo@site.com". This
 * walks every element's own direct text nodes and joins them with a single
 * space, so visually-separate pieces of text stay separate.
 */
export function extractSpacedText($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode> = $("body")): string {
  const parts: string[] = [];
  root
    .find("*")
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type === "text") {
        const text = $(node).text().trim();
        if (text) parts.push(text);
      }
    });
  return parts.join(" ");
}

/** Strips nav/footer/script/style and returns visible text, capped in length. */
export function extractCleanText(html: string, maxChars: number): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, noscript").remove();
  const text = extractSpacedText($).replace(/\s+/g, " ").trim();
  return text.slice(0, maxChars);
}
