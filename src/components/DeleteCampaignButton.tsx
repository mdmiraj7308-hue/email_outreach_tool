"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteCampaignButton({
  campaignRunId,
  label,
}: {
  campaignRunId: string;
  label: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete "${label}"? This permanently removes every lead, draft, and send history for this campaign, cancels any pending follow-ups, and deletes their rows from the connected Google Sheet. This can't be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/runs/${campaignRunId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete campaign");
      if (data.sheetError) {
        window.alert(
          `Campaign deleted, but the Sheet rows couldn't be removed automatically: ${data.sheetError}\nYou may need to delete them manually.`
        );
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete campaign");
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      title="Delete this campaign"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      {deleting ? (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-4 w-4 animate-spin">
          <path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m3 0-.867 12.142A2 2 0 0 1 15.138 21H8.862a2 2 0 0 1-1.995-1.858L6 7m4 5v6m4-6v6" />
        </svg>
      )}
    </button>
  );
}
