import { chromium, type Browser } from "playwright-core";
import path from "node:path";
import { createRequire } from "node:module";
import browsersRegistry from "./playwrightBrowsersRegistry.json";

const NAV_TIMEOUT_MS = 25_000;

/**
 * On Vercel, playwright-core's own registry code does a runtime
 * `require(path.join(packageRoot, "browsers.json"))` the first time
 * chromium.launch() is called. That file reliably gets dropped from the
 * deployed function no matter what outputFileTracingIncludes/
 * serverExternalPackages combination is set in next.config.ts (confirmed
 * across multiple real cache-free deploys) — Next's static tracer never
 * reliably picks it up. Rather than fight the bundler further, we
 * short-circuit Node's own module resolution for that exact absolute path
 * and hand back a copy of the file's contents that we bundled ourselves as
 * a plain JSON import (which Next always includes, since it's a normal
 * static import from our own source rather than a dynamic path computed
 * inside a third-party package at runtime).
 */
let browsersJsonPatched = false;
function patchPlaywrightBrowsersJson(): void {
  if (browsersJsonPatched || !process.env.VERCEL) return;
  browsersJsonPatched = true;
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Module = require("module") as any;
    const packageJsonPath = require.resolve("playwright-core/package.json");
    const browsersJsonPath = path.join(path.dirname(packageJsonPath), "browsers.json");

    Module._cache[browsersJsonPath] = {
      id: browsersJsonPath,
      filename: browsersJsonPath,
      loaded: true,
      exports: browsersRegistry,
    };

    const originalResolveFilename = Module._resolveFilename;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Module._resolveFilename = function (request: string, ...rest: any[]) {
      if (request === browsersJsonPath) return browsersJsonPath;
      return originalResolveFilename.call(this, request, ...rest);
    };
  } catch (err) {
    console.error("[headlessFetch] failed to patch playwright-core's browsers.json lookup", err);
  }
}

/**
 * Vercel's serverless functions can't run a full local Chromium install (too
 * large, no download step at runtime) — @sparticuz/chromium ships a trimmed
 * binary built for that environment. Locally, playwright-core resolves to
 * whatever Chromium `npx playwright install chromium` cached on this
 * machine, same as the full `playwright` package would.
 */
async function resolveLaunchOptions() {
  if (!process.env.VERCEL) return { headless: true as const };
  patchPlaywrightBrowsersJson();
  const chromiumBinary = (await import("@sparticuz/chromium")).default;
  return {
    args: chromiumBinary.args,
    executablePath: await chromiumBinary.executablePath(),
    headless: true as const,
  };
}

/**
 * Renders a page with a real headless browser — used only as a fallback when
 * a plain fetch comes back blocked (e.g. a Cloudflare "Just a moment..."
 * challenge page or a WAF 403). Much slower than a plain fetch, so callers
 * should only reach for this after a lightweight fetch has already failed.
 */
export async function fetchRenderedHtml(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // Cloudflare's managed challenge resolves itself client-side a couple
    // seconds after load; give it a moment before reading the DOM.
    await page.waitForTimeout(4000);
    return await page.content();
  } finally {
    await page.close();
  }
}

let sharedBrowser: Promise<Browser> | null = null;

/** Lazily launches one shared headless Chromium instance for the process, reused across crawls to avoid a multi-second launch cost per lead. */
export function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = resolveLaunchOptions().then((options) => chromium.launch(options));
  }
  return sharedBrowser;
}

const CHALLENGE_MARKERS = [
  "just a moment",
  "enable javascript and cookies to continue",
  "checking your browser",
  "cf-mitigated",
];

/** True when a response looks like a bot-wall block (WAF 403, or a Cloudflare/anti-bot JS challenge page) rather than a real 200 with content. */
export function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 503) return true;
  const lower = html.slice(0, 2000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}
