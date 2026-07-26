"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const PAGE_LABELS: { match: (path: string) => boolean; label: string }[] = [
  { match: (p) => p === "/", label: "Campaigns" },
  { match: (p) => p.startsWith("/runs/"), label: "Campaigns" },
  { match: (p) => p.startsWith("/leads/"), label: "Campaigns" },
  { match: (p) => p.startsWith("/summary"), label: "Summary" },
  { match: (p) => p.startsWith("/sending-campaigns"), label: "Sending Campaigns" },
  { match: (p) => p.startsWith("/today"), label: "Today's Sending" },
  { match: (p) => p.startsWith("/followups"), label: "Follow-ups" },
  { match: (p) => p.startsWith("/stats"), label: "Stats" },
  { match: (p) => p.startsWith("/settings"), label: "Settings" },
];

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const label = PAGE_LABELS.find((p) => p.match(pathname))?.label ?? "";

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-white px-6">
      <span className="text-base font-medium text-[var(--ink-soft)]">{label}</span>

      <div className="flex items-center gap-1">
        <Link
          href="/settings"
          className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-neutral-100 hover:text-[var(--ink)]"
          title="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-neutral-100 hover:text-[var(--ink)]"
          title="Help"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.09 9a3 3 0 015.83 1c0 2-3 2-3 4M12 17h.01"
            />
            <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
          </svg>
        </button>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-neutral-100 hover:text-[var(--ink)]"
          title="Notifications"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </button>
        <button
          onClick={handleSignOut}
          className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-neutral-100 hover:text-[var(--ink)]"
          title="Sign out"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
