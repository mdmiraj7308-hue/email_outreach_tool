-- Lets each follow-up stage be turned off entirely, independent of spacing.
ALTER TABLE "Settings" ADD COLUMN "followupEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ADD COLUMN "followup2Enabled" BOOLEAN NOT NULL DEFAULT true;
