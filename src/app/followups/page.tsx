import { getTodaySends } from "@/lib/todaySends";
import { TodaySendingView } from "@/components/TodaySendingView";

export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  const [followup1, followup2] = await Promise.all([
    getTodaySends("followup1"),
    getTodaySends("followup2"),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">Follow-ups</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Today's pending follow-ups (or the next upcoming batch, if nothing's due today), each
          sent only from the same account that sent email 1.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--ink)]">2nd Follow-up</h2>
        <TodaySendingView bucket="followup1" initialItems={followup1.items} initialIsUpcoming={followup1.isUpcoming} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--ink)]">3rd Follow-up</h2>
        <TodaySendingView bucket="followup2" initialItems={followup2.items} initialIsUpcoming={followup2.isUpcoming} />
      </section>
    </div>
  );
}
