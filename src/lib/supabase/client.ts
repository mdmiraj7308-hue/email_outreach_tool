"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client — used by the login page and a sign-out button. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
