import type { Browser } from "playwright-core";
import { createRequire } from "node:module";
import browsersRegistry from "./playwrightBrowsersRegistry.json";

const NAV_TIMEOUT_MS = 25_000;

/**
 * On Vercel, playwright-core's own registry code does a runtime
 * `require(path.join(packageRoot, "browsers.json"))` — and it does this the
 * moment the package itself is imported, not lazily at chromium.launch()
 * time. That file reliably gets dropped from the deployed function no
 * matter what outputFileTracingIncludes/serverExternalPackages combination
 * is set in next.config.ts (confirmed across multiple real cache-free
 * deploys), so we short-circuit Node's own module resolution for that exact
 * absolute path and hand back a copy of the file's contents that we bundled
 * ourselves as a plain JSON import (which Next always includes, since it's
 * a normal static import from our own source rather than a dynamic path
 * computed inside a third-party package at runtime).
 *
 * Critically, this must run BEFORE playwright-core is loaded at all — a
 * static `import { chromium } from "playwright-core"` at the top of this
 * file would get hoisted and evaluated before this patch (or any other
 * code in this file) ever runs, crashing immediately. So playwright-core is
 * never statically imported here — only loaded via a dynamic import() after
 * this patch has already been applied at module load time below.
 */
let browsersJsonPatched = false;
function patchPlaywrightBrowsersJson(): void {
  if (browsersJsonPatched || !process.env.VERCEL) return;
  browsersJsonPatched = true;
  try {
    // Turbopack statically recognizes ANY call made through a value that
    // came from createRequire(...) and intercepts it at build time — it
    // doesn't matter what the call is named or what argument (literal or
    // runtime-computed) is passed, it still either rewrites the call to its
    // own internal numeric module id or throws "Cannot find module ... too
    // dynamic". Confirmed by trying: renaming the require binding (still
    // intercepted), obfuscating the require.resolve() argument (still
    // intercepted), obfuscating a bare require() argument (still
    // intercepted). The only thing that actually evades this is hiding the
    // require/Module logic inside a string evaluated via the Function
    // constructor — no bundler parses the contents of a runtime string as
    // part of the module's AST, so nothing inside it is visible to
    // Turbopack's static analysis. createRequire itself, and the values
    // passed in below, are ordinary function arguments and don't look like
    // a require pattern from the outside.
    //
    // Vercel's Node.js functions always run with /var/task as the function
    // root and node_modules flattened directly under it — confirmed
    // repeatedly in this exact deployment's own error logs — so the path is
    // hardcoded rather than derived via require.resolve().
    const runUnanalyzed = new Function(
      "createRequire",
      "url",
      "browsersRegistry",
      `
        var nodeRequire = createRequire(url);
        var Module = nodeRequire("module");
        var browsersJsonPath = "/var/task/node_modules/playwright-core/browsers.json";
        Module._cache[browsersJsonPath] = {
          id: browsersJsonPath,
          filename: browsersJsonPath,
          loaded: true,
          exports: browsersRegistry,
        };
        var originalResolveFilename = Module._resolveFilename;
        Module._resolveFilename = function (request) {
          if (request === browsersJsonPath) return browsersJsonPath;
          return originalResolveFilename.apply(this, arguments);
        };
      `
    );
    runUnanalyzed(createRequire, import.meta.url, browsersRegistry);
  } catch (err) {
    console.error("[headlessFetch] failed to patch playwright-core's browsers.json lookup", err);
  }
}

// Runs once, immediately, the first time this module is loaded — before any
// caller has a chance to trigger a dynamic import of playwright-core below.
patchPlaywrightBrowsersJson();

async function loadChromium() {
  const { chromium } = await import("playwright-core");
  return chromium;
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
    sharedBrowser = resolveLaunchOptions().then(async (options) => {
      const chromium = await loadChromium();
      return chromium.launch(options);
    });
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
