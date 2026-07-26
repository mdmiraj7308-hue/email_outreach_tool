"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/summary",
    label: "Summary",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
      </svg>
    ),
  },
  {
    href: "/",
    label: "Campaigns",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9-4 9 4-9 4-9-4z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9 4 9-4M3 17l9 4 9-4" />
      </svg>
    ),
  },
  {
    href: "/sending-campaigns",
    label: "Sending Campaigns",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v4H4zM4 12h16v8H4z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16h8" />
      </svg>
    ),
  },
  {
    href: "/today",
    label: "Today's Sending",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z" />
      </svg>
    ),
  },
  {
    href: "/followups",
    label: "Follow-ups",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15a8 8 0 0014.9 2.5M19.5 9a8 8 0 00-14.9-2.5" />
      </svg>
    ),
  },
  {
    href: "/stats",
    label: "Stats",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V10M12 19V5M20 19v-7" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-6 w-6">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] px-4 py-6">
      <div className="flex items-center gap-2.5 px-3 pb-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand)] text-base font-bold text-white">
          E
        </div>
        <span className="text-xl font-semibold text-[var(--brand-dark)]">Outreach</span>
      </div>

      <nav className="flex flex-col gap-1.5">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3.5 rounded-xl px-4 py-3 text-base font-medium transition ${
                isActive
                  ? "bg-[var(--sidebar-active-bg)] text-[var(--ink)]"
                  : "text-[var(--ink-soft)] hover:bg-neutral-100 hover:text-[var(--ink)]"
              }`}
            >
              {isActive && (
                <span className="absolute -right-4 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-[var(--brand)]" />
              )}
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-3 pt-6 text-sm text-[var(--ink-soft)]">
        Local instance · running on your machine
      </div>
    </aside>
  );
}
