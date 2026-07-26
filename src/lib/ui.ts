// Shared Tailwind class strings so buttons/cards/badges stay visually
// consistent across the app without a component library.

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-base font-medium text-white shadow-sm transition hover:bg-[var(--brand-dark)] disabled:opacity-50 disabled:cursor-not-allowed";

export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-white px-5 py-2.5 text-base font-medium text-[var(--ink)] shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed";

export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-medium text-[var(--ink-soft)] transition hover:bg-neutral-100 disabled:opacity-50";

export const btnDanger =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50";

export const card = "rounded-2xl border border-[var(--border)] bg-white p-7 shadow-sm";

export const input =
  "w-full rounded-xl border border-[var(--border)] px-4 py-3 text-base text-[var(--ink)] placeholder:text-neutral-400 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]";

export function badgeClass(tone: "neutral" | "blue" | "amber" | "green" | "purple" | "red"): string {
  const tones: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-600",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-[var(--brand-light)] text-[var(--brand-dark)]",
    purple: "bg-purple-50 text-purple-700",
    red: "bg-red-50 text-red-700",
  };
  return `inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${tones[tone]}`;
}

const STATUS_TONE: Record<string, "neutral" | "blue" | "amber" | "green" | "purple" | "red"> = {
  pending: "neutral",
  scraping: "blue",
  scraped: "blue",
  enriching: "amber",
  ready: "green",
  sending: "purple",
  done: "green",
  failed: "red",
  crawling: "amber",
  summarizing: "amber",
  unreachable: "red",
  sent: "green",
  scheduled: "blue",
  skipped_reply: "neutral",
  cancelled: "neutral",
};

export function statusBadgeClass(status: string): string {
  return badgeClass(STATUS_TONE[status] ?? "neutral");
}

/** Fit/lead-type badge for the run's lead table and lead detail page. */
export function fitBadge(
  leadType: string,
  fitScore: number
): { label: string; className: string } {
  if (leadType === "no_website") {
    return { label: "No Website", className: badgeClass("purple") };
  }
  if (fitScore < 0) {
    return { label: "Unscored", className: badgeClass("neutral") };
  }
  if (fitScore >= 60) {
    return { label: `${fitScore}/100 · Good Fit`, className: badgeClass("green") };
  }
  return { label: `${fitScore}/100 · Poor Fit`, className: badgeClass("red") };
}

/** Badge for a local spam-heuristic score (0-100, higher = worse). */
export function spamScoreBadge(score: number): { label: string; className: string } {
  if (score < 30) return { label: `spam ${score}`, className: badgeClass("green") };
  if (score < 60) return { label: `spam ${score}`, className: badgeClass("amber") };
  return { label: `spam ${score}`, className: badgeClass("red") };
}

/** Badge flagging a lead's email as undeliverable — either failed the local
 * MX/syntax check or produced a real Gmail bounce. Returns null when there's
 * nothing to flag (valid/unverified and not bounced), so callers can skip
 * rendering entirely. */
export function emailDeliverabilityBadge(
  emailVerificationStatus: string,
  bounced: boolean
): { label: string; className: string } | null {
  if (bounced) return { label: "Bounced", className: badgeClass("red") };
  if (emailVerificationStatus === "invalid") {
    return { label: "Invalid Email", className: badgeClass("red") };
  }
  return null;
}
