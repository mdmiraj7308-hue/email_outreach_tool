import { StatsView } from "@/components/StatsView";

export default function StatsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">Send Stats</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Track sends today and over time, broken down by sender account.
        </p>
      </div>
      <StatsView />
    </div>
  );
}
