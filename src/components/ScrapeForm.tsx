"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { btnGhost, btnPrimary, input as inputClass } from "@/lib/ui";

export function ScrapeForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useState("");
  const [splitMode, setSplitMode] = useState<"auto" | "manual" | "off">("auto");
  const [additionalLocationsText, setAdditionalLocationsText] = useState("");
  const [preferredService, setPreferredService] = useState("");
  const [maxLeads, setMaxLeads] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrapeLimit, setScrapeLimit] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setScrapeLimit(typeof data.globalScrapeLimit === "number" ? data.globalScrapeLimit : null))
      .catch(() => {});
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const additionalLocations =
        splitMode === "manual"
          ? additionalLocationsText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
          : [];
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchQuery,
          location,
          maxLeads,
          preferredService,
          additionalLocations,
          autoGrid: splitMode === "auto",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.formErrors?.join(", ") ?? data.error ?? "Failed to start scrape");
      }
      setOpen(false);
      setSearchQuery("");
      setLocation("");
      setAdditionalLocationsText("");
      setSplitMode("auto");
      setPreferredService("");
      setMaxLeads(20);
      router.push(`/runs/${data.campaignRunId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start scrape");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btnPrimary}>
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        New Scrape
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg space-y-6 rounded-2xl bg-white p-8 shadow-xl"
      >
        <div>
          <h2 className="text-xl font-semibold text-[var(--ink)]">New Scrape</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Pull local business leads from Google Maps.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-base font-medium text-[var(--ink)]">
            Business type / search query
          </label>
          <input
            required
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. dentists, coffee shops"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-base font-medium text-[var(--ink)]">Location</label>
          <input
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Austin, TX"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-base font-medium text-[var(--ink)]">
            Covering more than ~100 leads
          </label>
          <p className="text-sm text-[var(--ink-soft)]">
            Google Maps caps a single search+location at ~120 results no matter how many
            businesses actually exist, so a broad city search alone won&apos;t reach a large "max
            leads" target.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
              <input
                type="radio"
                className="mt-1"
                checked={splitMode === "auto"}
                onChange={() => setSplitMode("auto")}
              />
              <span>
                <span className="font-medium">Auto-split (recommended)</span> — automatically
                divides the area into a non-overlapping search grid sized to reach your max leads
                below, searching finer where it finds a dense cluster. Duplicates across tiles are
                skipped automatically.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
              <input
                type="radio"
                className="mt-1"
                checked={splitMode === "manual"}
                onChange={() => setSplitMode("manual")}
              />
              <span className="font-medium">Manual — I&apos;ll list specific areas myself</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-[var(--ink)]">
              <input
                type="radio"
                className="mt-1"
                checked={splitMode === "off"}
                onChange={() => setSplitMode("off")}
              />
              <span className="font-medium">Off — just search the one location above</span>
            </label>
          </div>
          {splitMode === "manual" && (
            <textarea
              value={additionalLocationsText}
              onChange={(e) => setAdditionalLocationsText(e.target.value)}
              placeholder={"e.g.\n78701\n78702\nRound Rock, TX"}
              rows={3}
              className={`${inputClass} mt-2`}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-base font-medium text-[var(--ink)]">
            Preferred service to offer <span className="text-[var(--ink-soft)]">(optional)</span>
          </label>
          <input
            value={preferredService}
            onChange={(e) => setPreferredService(e.target.value)}
            placeholder="e.g. Voice AI receptionist for dental practices"
            className={inputClass}
          />
          <p className="text-sm text-[var(--ink-soft)]">
            If set, the AI pitches this specific service for this batch of leads instead of a
            generic automation pitch.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-base font-medium text-[var(--ink)]">
            Max leads to scrape{" "}
            <span className="text-[var(--ink-soft)]">
              ({splitMode === "manual" ? "per area" : "target"})
            </span>
          </label>
          <input
            required
            type="number"
            min={1}
            max={500}
            value={maxLeads}
            onChange={(e) => setMaxLeads(Number(e.target.value))}
            className={inputClass}
          />
          {scrapeLimit !== null && maxLeads > scrapeLimit && (
            <p className="text-sm text-amber-600">
              Your Settings cap any single scrape at {scrapeLimit} leads — this request will be
              silently capped to {scrapeLimit}. Raise &quot;Global Scrape Limit&quot; in Settings
              first if you actually need more.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? "Starting…" : "Start Scrape"}
          </button>
        </div>
      </form>
    </div>
  );
}
