import { SummaryView } from "@/components/SummaryView";

export default function SummaryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">Summary</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Overview across all campaign runs: leads scraped, sends, follow-ups, replies, and
          per-sender health.
        </p>
      </div>
      <SummaryView />
    </div>
  );
}
