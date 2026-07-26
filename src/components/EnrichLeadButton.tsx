"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnSecondary } from "@/lib/ui";

export function EnrichLeadButton({ leadId, label }: { leadId: string; label: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleClick} disabled={running} className={btnSecondary}>
        {running ? "Working…" : label}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
