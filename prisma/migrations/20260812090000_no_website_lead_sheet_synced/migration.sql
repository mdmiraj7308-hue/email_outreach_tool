-- Tracks whether a NoWebsiteLead actually made it to the "No Website Leads"
-- sheet tab, so a real re-sync action can find and retry whatever the
-- best-effort insert-time push missed.
ALTER TABLE "NoWebsiteLead" ADD COLUMN "sheetSynced" BOOLEAN NOT NULL DEFAULT false;
