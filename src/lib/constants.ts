export const LLM_PROVIDERS = ["anthropic", "openai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

export const CAMPAIGN_RUN_STATUSES = [
  "pending",
  "scraping",
  "scraped",
  "enriching",
  "ready",
  "sending",
  "done",
  "failed",
] as const;

export const ENRICHMENT_STATUSES = [
  "pending",
  "crawling",
  "summarizing",
  "done",
  "failed",
  "unreachable",
] as const;

export const EMAIL_SEND_STATUSES = [
  "ready", // drafted, waiting for an explicit "Start Sending"/"Send Now" — never auto-dispatched
  "scheduled",
  "sent",
  "failed",
  "skipped_reply",
  "cancelled",
] as const;

export const EMAIL_PURPOSES = ["cold", "followup1", "followup2"] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

export const GOOGLE_SHEET_HEADERS = [
  "Date",
  "Business Name",
  "Website",
  "Email Address",
  "Phone",
  "LinkedIn URL",
  "About Summary",
  "Fit Score",
  "Email 1 Subject",
  "Email 1 Body",
  "Follow-up 1 Subject",
  "Follow-up 1 Body",
  "Follow-up 2 Subject",
  "Follow-up 2 Body",
  "Sent From",
  "Reply Status",
];

export const FOLLOWUP_JOB_INTERVAL_MS = 60_000;
export const REPLY_CHECK_JOB_INTERVAL_MS = 5 * 60_000;
export const BOUNCE_CHECK_JOB_INTERVAL_MS = 5 * 60_000;
export const SCRAPE_ADVANCE_JOB_INTERVAL_MS = 5_000;

// Step-3 qualification filter: a lead must have a discovered email AND a
// fit score at/above this to be eligible for batch drafting/sending.
// Deliberately distinct from FIT_SCORE_GOOD_THRESHOLD (60) in prompts.ts,
// which only labels the "good fit" verdict shown on the lead card.
export const LEAD_FILTER_MIN_FIT_SCORE = 50;
