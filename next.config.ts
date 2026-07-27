import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core reads its own browsers.json at runtime via a dynamic
  // require(path.join(...)) Vercel's static file-tracer can miss, so it gets
  // dropped from the deployed function unless force-included here — without
  // this, /api/enrich's Cloudflare-bypass headless-browser fallback throws
  // "Cannot find module '.../playwright-core/browsers.json'" in production.
  // Matched against every route ("/**") rather than just "/api/enrich" in
  // case route-scoped keys aren't matching reliably on Vercel's build.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
