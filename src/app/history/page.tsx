import { HistoryView } from "@/components/HistoryView";

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">Send History</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Every email send attempt, most recent first, with the exact date and time.
        </p>
      </div>
      <HistoryView />
    </div>
  );
}
