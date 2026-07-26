-- CampaignRun: persisted orchestration state so a multi-location/tile scrape
-- can be advanced one step per cron tick instead of one long-lived
-- serverless background loop (which Vercel can't reliably keep alive for).
ALTER TABLE "CampaignRun" ADD COLUMN "scrapeQueue" TEXT;
ALTER TABLE "CampaignRun" ADD COLUMN "scrapeAccountId" TEXT;
