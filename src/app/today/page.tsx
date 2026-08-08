import { getTodaySends } from "@/lib/todaySends";
import { TodaySendingView } from "@/components/TodaySendingView";

export const dynamic = "force-dynamic";

export default async function TodaySendingPage() {
  const { items, isUpcoming } = await getTodaySends("first");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">
          Today's Sending Campaign
        </h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          First-email sends scheduled for today, across all runs.
        </p>
      </div>
      <TodaySendingView bucket="first" initialItems={items} initialIsUpcoming={isUpcoming} />
    </div>
  );
}
