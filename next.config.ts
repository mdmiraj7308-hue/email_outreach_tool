import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core reads its own browsers.json at runtime, and that file
  // reliably gets dropped from Vercel's deployed function no matter what's
  // set here — outputFileTracingIncludes below never fixed it on its own
  // (confirmed across several real deploys). Left in as harmless
  // defense-in-depth; the actual fix is the require-interception patch in
  // src/lib/enrichment/headlessFetch.ts, which doesn't depend on Vercel's
  // file tracing at all.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
