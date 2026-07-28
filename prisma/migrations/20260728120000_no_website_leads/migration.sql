-- Businesses scraped with no real website (a Google Maps listing url
-- doesn't count) are routed to their own lean table instead of Lead —
-- nothing for the enrichment/drafting/sending pipeline to do with them, so
-- they're pushed straight to the "No Website Leads" sheet tab and never
-- touch the main pipeline at all.
CREATE TABLE "NoWebsiteLead" (
    "id" TEXT NOT NULL,
    "campaignRunId" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "businessName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT 'null',
    "address" TEXT NOT NULL DEFAULT 'null',
    "category" TEXT NOT NULL DEFAULT 'null',
    "googleMapsUrl" TEXT NOT NULL DEFAULT 'null',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoWebsiteLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NoWebsiteLead_googlePlaceId_key" ON "NoWebsiteLead"("googlePlaceId");

CREATE INDEX "NoWebsiteLead_campaignRunId_idx" ON "NoWebsiteLead"("campaignRunId");

ALTER TABLE "NoWebsiteLead" ADD CONSTRAINT "NoWebsiteLead_campaignRunId_fkey" FOREIGN KEY ("campaignRunId") REFERENCES "CampaignRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
