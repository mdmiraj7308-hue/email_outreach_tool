-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "userName" TEXT,
    "userRole" TEXT,
    "userCompany" TEXT,
    "userBio" TEXT,
    "tonePreference" TEXT,
    "activeLlmProvider" TEXT,
    "anthropicApiKey" TEXT,
    "anthropicModel" TEXT,
    "openaiApiKey" TEXT,
    "openaiModel" TEXT,
    "googleServiceAccountJson" TEXT,
    "googleSheetId" TEXT,
    "globalScrapeLimit" INTEGER NOT NULL DEFAULT 100,
    "globalSendLimit" INTEGER NOT NULL DEFAULT 50,
    "dailyCapCold" INTEGER NOT NULL DEFAULT 20,
    "dailyCapFollowup2" INTEGER NOT NULL DEFAULT 20,
    "dailyCapFollowup3" INTEGER NOT NULL DEFAULT 20,
    "businessHoursStartHour" INTEGER NOT NULL DEFAULT 9,
    "businessHoursEndHour" INTEGER NOT NULL DEFAULT 17,
    "businessHoursTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "followupSpacingDays" INTEGER NOT NULL DEFAULT 3,
    "followup2SpacingDays" INTEGER,
    "emailSystemPromptOverride" TEXT,
    "firstSendPauseMinSeconds" INTEGER NOT NULL DEFAULT 5,
    "firstSendPauseMaxSeconds" INTEGER NOT NULL DEFAULT 120,
    "followupPauseMinSeconds" INTEGER NOT NULL DEFAULT 5,
    "followupPauseMaxSeconds" INTEGER NOT NULL DEFAULT 100,
    "spamScoreThreshold" INTEGER NOT NULL DEFAULT 70,
    "spamScoreAction" TEXT NOT NULL DEFAULT 'block',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRun" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "searchQuery" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "maxLeads" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "apifyRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preferredService" TEXT NOT NULL DEFAULT 'null',
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "campaignRunId" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "businessName" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT 'null',
    "category" TEXT NOT NULL DEFAULT 'null',
    "scrapedEmail" TEXT NOT NULL DEFAULT 'null',
    "primaryEmail" TEXT NOT NULL DEFAULT 'null',
    "phone" TEXT NOT NULL DEFAULT 'null',
    "address" TEXT NOT NULL DEFAULT 'null',
    "linkedinUrl" TEXT NOT NULL DEFAULT 'null',
    "aboutSummary" TEXT NOT NULL DEFAULT 'null',
    "leadType" TEXT NOT NULL DEFAULT 'standard',
    "fitScore" INTEGER NOT NULL DEFAULT -1,
    "fitVerdict" TEXT NOT NULL DEFAULT 'unknown',
    "fitReason" TEXT NOT NULL DEFAULT 'null',
    "teamSizeEstimate" TEXT NOT NULL DEFAULT 'null',
    "hasManualWorkflows" BOOLEAN NOT NULL DEFAULT false,
    "hasAiOrTechStaff" BOOLEAN NOT NULL DEFAULT false,
    "enrichmentStatus" TEXT NOT NULL DEFAULT 'pending',
    "enrichmentError" TEXT,
    "emailVerificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "bounced" BOOLEAN NOT NULL DEFAULT false,
    "replyStatus" TEXT NOT NULL DEFAULT 'No',
    "sheetRowNumber" INTEGER,
    "sheetRowSynced" BOOLEAN NOT NULL DEFAULT false,
    "followup2ScheduledFor" TIMESTAMP(3),
    "followup3ScheduledFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "emailDraftId" TEXT NOT NULL,
    "senderAccountId" TEXT,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "errorMessage" TEXT,
    "spamCheckScore" INTEGER,
    "spamCheckFlags" TEXT,
    "sentManually" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderAccount" (
    "id" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "dailyCapCold" INTEGER,
    "dailyCapFollowup2" INTEGER,
    "dailyCapFollowup3" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spamScore" INTEGER NOT NULL DEFAULT 0,
    "spamScoreUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "SenderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApifyAccount" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "leadsScraped" INTEGER NOT NULL DEFAULT 0,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 1000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApifyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingCampaign" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "SendingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingCampaignLead" (
    "id" TEXT NOT NULL,
    "sendingCampaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendingCampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySendCounter" (
    "id" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailySendCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "refId" TEXT,
    "status" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_googlePlaceId_key" ON "Lead"("googlePlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDraft_leadId_sequence_key" ON "EmailDraft"("leadId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSend_emailDraftId_key" ON "EmailSend"("emailDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "SenderAccount_emailAddress_key" ON "SenderAccount"("emailAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SendingCampaignLead_sendingCampaignId_leadId_key" ON "SendingCampaignLead"("sendingCampaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "DailySendCounter_senderAccountId_date_sequence_key" ON "DailySendCounter"("senderAccountId", "date", "sequence");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignRunId_fkey" FOREIGN KEY ("campaignRunId") REFERENCES "CampaignRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_emailDraftId_fkey" FOREIGN KEY ("emailDraftId") REFERENCES "EmailDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "SenderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingCampaignLead" ADD CONSTRAINT "SendingCampaignLead_sendingCampaignId_fkey" FOREIGN KEY ("sendingCampaignId") REFERENCES "SendingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingCampaignLead" ADD CONSTRAINT "SendingCampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingCampaignLead" ADD CONSTRAINT "SendingCampaignLead_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "SenderAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySendCounter" ADD CONSTRAINT "DailySendCounter_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "SenderAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

