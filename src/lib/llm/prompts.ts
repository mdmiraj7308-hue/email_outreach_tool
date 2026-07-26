import { z } from "zod";
import type { LlmClient } from "@/lib/llm";

function extractJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function attemptJson<T>(
  llm: LlmClient,
  system: string,
  userPrompt: string,
  schema: z.ZodType<T>
): Promise<T> {
  const attempt = async (extraInstruction?: string) => {
    const prompt = extraInstruction ? `${userPrompt}\n\n${extraInstruction}` : userPrompt;
    const raw = await llm.complete(system, prompt);
    return schema.parse(extractJson(raw));
  };

  try {
    return await attempt();
  } catch {
    return await attempt(
      "Your previous response was not valid JSON in the required shape. Respond with ONLY the JSON object, no markdown fences, no commentary."
    );
  }
}

// ---------------------------------------------------------------------------
// Business analysis: About Summary + fit judgment for the AI-automation
// offer, produced in one call since both read the same crawled content.
// ---------------------------------------------------------------------------

const FIT_SCORE_GOOD_THRESHOLD = 60;

const businessAnalysisSchema = z.object({
  summary: z.string().min(1),
  teamSizeEstimate: z.string().min(1), // e.g. "solo", "2-10", "11-50", "50+", "unknown"
  hasManualWorkflows: z.boolean(),
  hasAiOrTechStaff: z.boolean(),
  fitScore: z.number().int().min(0).max(100),
  fitReason: z.string().min(1),
});

export type BusinessAnalysis = z.infer<typeof businessAnalysisSchema> & {
  fitVerdict: "good_fit" | "poor_fit";
};

const BUSINESS_ANALYSIS_SYSTEM_PROMPT = `You analyze a small business's website on behalf of an independent AI engineer who offers ongoing AI automation partnerships (auditing a business, then implementing AI systems, workflow automation, and custom AI applications for a monthly retainer).

You do two things from the same source text:

1. Write a concise but information-dense summary (120-200 words) covering, where the source text supports it: what the business actually does and who they serve, services offered and how they're structured, pricing model if mentioned (exact numbers if present), team/founders if named, and anything that suggests a manual, repetitive, or inefficient process. Do not invent details the source text doesn't support — omit a section rather than guessing. Plain text, no headers or bullets.

2. Score how good a fit this business is for the AI engineer's offer, from 0 (definitely not a fit) to 100 (ideal fit), using these signals:
   - PUSH THE SCORE UP: visible manual processes (phone/email-only booking, no online scheduling, spreadsheet-sounding operations, "call us" instead of a booking widget), no CRM/automation tooling mentioned or badged (no Calendly/Acuity/HubSpot/Zapier/etc.), no AI-related staff or "AI-powered" claims anywhere, a small-to-medium team (roughly 1-30 people), an established operating business (not brand new, not clearly struggling).
   - PUSH THE SCORE DOWN: the site already advertises AI-powered features or has AI/ML/data roles on the team, mentions of raised venture funding ("backed by," "Series A"), obvious franchise/multi-location chain language, enterprise/large-corporate structure (RFP language, "enterprise solutions," a large numbered team).
   - When signals conflict (e.g. a 12-person team that's still clearly manual vs. a 3-person team that's already automated), weight the manual-workflow/no-AI-expertise signal heavier than team size alone — a manual 12-person team should still score well above 60.
   - Use the full 0-100 range based on how strong the evidence is — don't cluster everything near 50. Strong, multiple manual-workflow signals with zero automation should score 80-100. A mix of some automation and some manual signals should land 40-65. Clear disqualifiers (AI staff, funding, enterprise structure) should score under 30.

Respond with ONLY a single JSON object, no markdown code fences, no commentary, in exactly this shape:
{"summary": "...", "teamSizeEstimate": "...", "hasManualWorkflows": true, "hasAiOrTechStaff": false, "fitScore": 82, "fitReason": "one sentence explaining the score"}`;

export async function generateBusinessAnalysis(
  llm: LlmClient,
  businessName: string,
  websiteContent: string
): Promise<BusinessAnalysis> {
  const userPrompt = `Business name: ${businessName}\n\nWebsite content (scraped from homepage and other pages):\n${websiteContent}`;
  const result = await attemptJson(llm, BUSINESS_ANALYSIS_SYSTEM_PROMPT, userPrompt, businessAnalysisSchema);
  return {
    ...result,
    fitVerdict: result.fitScore >= FIT_SCORE_GOOD_THRESHOLD ? "good_fit" : "poor_fit",
  };
}

// ---------------------------------------------------------------------------
// Sender profile + shared email-sequence types
// ---------------------------------------------------------------------------

export interface SenderProfile {
  userName: string | null;
  userRole: string | null;
  userCompany: string | null;
  userBio: string | null;
  tonePreference: string | null;
}

const emailDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

const emailSequenceSchema = z.object({
  email1: emailDraftSchema,
  email2: emailDraftSchema,
  email3: emailDraftSchema,
});

export type EmailSequence = z.infer<typeof emailSequenceSchema>;

function senderIdentityBlock(profile: SenderProfile): string {
  const senderLine = [profile.userName, profile.userRole, profile.userCompany]
    .filter(Boolean)
    .join(", ");
  return `Sender: ${senderLine || "the sender"}${
    profile.userBio ? `\nSender's background, skills, and how they work (use this to sound like a genuine expert, not a generic salesperson — reference specific relevant skills/experience where they naturally support the pitch):\n${profile.userBio}` : ""
  }\nTone: ${profile.tonePreference || "casual, human, direct"}`;
}

const EMAIL_HARD_RULES = `Hard rules for every email:
- Write like a real person typed it, not a marketer. Short sentences. Plain words. No jargon, no buzzwords, no "synergy/leverage/unlock/game-changer/revolutionize" type language.
- Plain text only. No HTML tags, no markdown links, no tracking pixels, no UTM parameters, no image tags.
- Short and to the point: ~80-130 words for email 1, shorter for the follow-ups. Every sentence should earn its place — cut anything that doesn't.
- No signature block or legal footer — sign off with just the sender's first name.
- Subject lines must be plain and low-key — no emoji, no all-caps, no "Save 10 hours/week!!" style marketing hooks.`;

// ---------------------------------------------------------------------------
// Standard sequence: AI automation pitch, for leads with a website + analysis
// ---------------------------------------------------------------------------

function appendCustomInstructions(prompt: string, customSystemPrompt?: string | null): string {
  const trimmed = customSystemPrompt?.trim();
  if (!trimmed) return prompt;
  return `${prompt}\n\nAdditional instructions from the sender for this batch:\n${trimmed}`;
}

function buildAutomationEmailSystemPrompt(
  profile: SenderProfile,
  preferredService: string | null,
  customSystemPrompt?: string | null
): string {
  const offerLine = preferredService
    ? `Specifically, pitch this: ${preferredService}. Frame the whole sequence around this specific service — don't pitch a vague general "AI automation partnership," pitch this concrete thing and why it fits this specific business. It's fine to mention that a broader audit/partnership could follow once this is in place, but this specific service is the actual ask.`
    : `Pitch an ongoing AI automation partnership: an audit of their business, then implementing AI systems, workflow automation, and custom AI applications, billed as a monthly retainer.`;

  const prompt = `You write a 3-email cold outreach sequence on behalf of a real independent AI engineer, reaching out to a small/local business owner.

${offerLine}

${senderIdentityBlock(profile)}

${EMAIL_HARD_RULES}
- Must reference something SPECIFIC from the business's About Summary AND the manual-workflow/fit evidence below — it must read like the sender actually looked at this specific business, not a template. Naming the concrete manual process you noticed (e.g. phone-only booking, spreadsheet-sounding ops) is far stronger than generic "I help businesses like yours."
- Connect that specific observation to a specific relevant skill or past result from the sender's background — this is what makes the email read as coming from a real expert who understands both their business and how to fix it, not a generic outreach template.

Email-specific guidance:
- email1 (cold outreach): brief intro, name the specific manual/inefficient process you noticed and why it's costing them, soft call-to-action (e.g. "worth a quick chat?").
- email2 (follow-up 1): assume no reply yet, add a new angle or value point (a different specific observation, or a brief relevant result from the sender's background), reference the first email loosely (e.g. "following up on my note last week").
- email3 (follow-up 2): assume still no reply, one more distinct angle, keep it brief and low-pressure.

Respond with ONLY a single JSON object, no markdown code fences, no commentary, in exactly this shape:
{"email1": {"subject": "...", "body": "..."}, "email2": {"subject": "...", "body": "..."}, "email3": {"subject": "...", "body": "..."}}`;

  return appendCustomInstructions(prompt, customSystemPrompt);
}

export interface FitSignals {
  teamSizeEstimate: string | null;
  hasManualWorkflows: boolean;
  fitReason: string | null;
}

export async function generateEmailSequence(
  llm: LlmClient,
  businessName: string,
  aboutSummary: string,
  profile: SenderProfile,
  fitSignals?: FitSignals,
  preferredService?: string | null,
  customSystemPrompt?: string | null
): Promise<EmailSequence> {
  const system = buildAutomationEmailSystemPrompt(profile, preferredService ?? null, customSystemPrompt);
  const fitLines = fitSignals
    ? `\n\nTeam size estimate: ${fitSignals.teamSizeEstimate ?? "unknown"}\nShows manual-workflow signals: ${fitSignals.hasManualWorkflows ? "yes" : "no"}\nWhy this looked like a fit: ${fitSignals.fitReason ?? "n/a"}`
    : "";
  const userPrompt = `Business name: ${businessName}\n\nAbout Summary:\n${aboutSummary}${fitLines}`;
  return attemptJson(llm, system, userPrompt, emailSequenceSchema);
}

// ---------------------------------------------------------------------------
// Website-offer sequence: for leads with no website at all. We can't judge
// fit or crawl anything, so this pitches a narrower, cheaper foot-in-the-door
// offer (build them a site) using only what Google Maps gave us.
// ---------------------------------------------------------------------------

function buildWebsiteOfferSystemPrompt(
  profile: SenderProfile,
  customSystemPrompt?: string | null
): string {
  const prompt = `You write a 3-email cold outreach sequence on behalf of a real independent AI engineer/developer. The target business has NO website at all (confirmed via Google Maps), so this pitch is specifically for building them a professional website — not the sender's usual AI automation service. Mention briefly that this can also set them up for automation/AI tools down the road once they have a web presence, but the primary ask here is the website itself.

${senderIdentityBlock(profile)}

${EMAIL_HARD_RULES}
- Reference the business's name/type/location naturally so it doesn't read like a mass blast, but don't invent details about their operations you don't actually know (we have no website to read for this lead).
- Keep the tone helpful, not alarmist — frame having no website as a missed opportunity, not a failure.

Email-specific guidance:
- email1: brief intro, note they don't appear to have a website yet and what that's likely costing them (customers who search online and can't find them), soft call-to-action.
- email2 (follow-up 1): assume no reply, add a different angle (e.g. how fast/affordable a first version could be, or what it unlocks later like online booking or automation), reference the first email loosely.
- email3 (follow-up 2): assume still no reply, one more brief low-pressure angle.

Respond with ONLY a single JSON object, no markdown code fences, no commentary, in exactly this shape:
{"email1": {"subject": "...", "body": "..."}, "email2": {"subject": "...", "body": "..."}, "email3": {"subject": "...", "body": "..."}}`;

  return appendCustomInstructions(prompt, customSystemPrompt);
}

export async function generateWebsiteOfferEmailSequence(
  llm: LlmClient,
  businessName: string,
  category: string | null,
  location: string | null,
  profile: SenderProfile,
  customSystemPrompt?: string | null
): Promise<EmailSequence> {
  const system = buildWebsiteOfferSystemPrompt(profile, customSystemPrompt);
  const details = [
    category ? `Business type: ${category}` : null,
    location ? `Location: ${location}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const userPrompt = `Business name: ${businessName}${details ? `\n${details}` : ""}\n\nThis business has no website found via Google Maps or web search.`;
  return attemptJson(llm, system, userPrompt, emailSequenceSchema);
}
