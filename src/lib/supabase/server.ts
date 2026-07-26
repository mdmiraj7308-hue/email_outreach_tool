import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (server components, route handlers) —
 * reads/writes the session via Next.js cookies so it stays in sync with
 * middleware.ts, which is what actually enforces the login gate.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component (not a Route Handler/Server
            // Action) — cookies can't be set there. Harmless as long as
            // middleware.ts is also refreshing the session on every request.
          }
        },
      },
    }
  );
}
