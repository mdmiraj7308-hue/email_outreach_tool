-- Optional monthly auto-reset for every ApifyAccount's leadsScraped counter.
ALTER TABLE "Settings" ADD COLUMN "apifyResetDayOfMonth" INTEGER;
ALTER TABLE "Settings" ADD COLUMN "apifyResetLastRunAt" TIMESTAMP(3);
