import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core reads its own browsers.json at runtime via a dynamic
  // path Vercel's static file-tracer can't detect, so it gets dropped from
  // the deployed function unless force-included here — without this,
  // /api/enrich's Cloudflare-bypass headless-browser fallback throws
  // "Cannot find module '.../playwright-core/browsers.json'" in production.
  outputFileTracingIncludes: {
    "/api/enrich": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
