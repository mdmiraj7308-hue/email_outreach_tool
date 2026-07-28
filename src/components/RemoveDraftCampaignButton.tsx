"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnGhost } from "@/lib/ui";

export function RemoveDraftCampaignButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function handleRemove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        "Remove this draft campaign? Its leads go back to the fresh qualified pool for a future campaign — nothing is deleted."
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch(`/api/sending-campaigns/${campaignId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove campaign");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to remove campaign");
      setRemoving(false);
    }
  }

  return (
    <button onClick={handleRemove} disabled={removing} className={btnGhost}>
      {removing ? "Removing…" : "Remove"}
    </button>
  );
}
