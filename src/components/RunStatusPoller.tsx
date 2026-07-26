"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Polls while a run is in flight and refreshes the page on a fixed cadence. */
export function RunStatusPoller({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!["pending", "scraping", "enriching", "sending"].includes(status)) return;
    // "sending" progress shows up in per-lead EmailSend counts, not the run
    // status itself, so refresh unconditionally rather than waiting for the
    // top-level status to change.
    const interval = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, status]);

  return null;
}
