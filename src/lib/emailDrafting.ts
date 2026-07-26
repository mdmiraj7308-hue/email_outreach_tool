import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getActiveLlmClient } from "@/lib/llm";
import { generateEmailSequence, generateWebsiteOfferEmailSequence } from "@/lib/llm/prompts";
import { EMAIL_PURPOSES } from "@/lib/constants";
import type { EmailDraft } from "@/generated/prisma/client";

export type WriteEmailsResult =
  | { ok: true; drafts: EmailDraft[] }
  | { ok: false; error: string };

/**
 * Drafts all 3 sequence emails for a lead (branching on leadType) and
 * upserts them as EmailDraft rows. Shared by the single-lead
 * /api/generate-emails route and the batch write-and-upload route so both
 * use identical drafting logic.
 */
export async function writeEmailsForLead(
  leadId: string,
  customSystemPrompt?: string | null
): Promise<WriteEmailsResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { campaignRun: { select: { preferredService: true } } },
  });
  if (!lead) {
    return { ok: false, error: "Lead not found" };
  }

  const isNoWebsite = lead.leadType === "no_website";
  if (!isNoWebsite && (!lead.aboutSummary || lead.aboutSummary === "null")) {
    return { ok: false, error: "Lead has no About Summary yet — run enrichment first." };
  }

  try {
    const settings = await getSettings();
    const llm = getActiveLlmClient(settings);
    const profile = {
      userName: settings.userName,
      userRole: settings.userRole,
      userCompany: settings.userCompany,
      userBio: settings.userBio,
      tonePreference: settings.tonePreference,
    };
    const effectivePrompt =
      customSystemPrompt ??
      (settings.emailSystemPromptOverride && settings.emailSystemPromptOverride.trim()
        ? settings.emailSystemPromptOverride
        : null);

    const sequence = isNoWebsite
      ? await generateWebsiteOfferEmailSequence(
          llm,
          lead.businessName,
          lead.category !== "null" ? lead.category : null,
          lead.address !== "null" ? lead.address : null,
          profile,
          effectivePrompt
        )
      : await generateEmailSequence(
          llm,
          lead.businessName,
          lead.aboutSummary,
          profile,
          {
            teamSizeEstimate: lead.teamSizeEstimate !== "null" ? lead.teamSizeEstimate : null,
            hasManualWorkflows: lead.hasManualWorkflows,
            fitReason: lead.fitReason !== "null" ? lead.fitReason : null,
          },
          lead.campaignRun.preferredService !== "null" ? lead.campaignRun.preferredService : null,
          effectivePrompt
        );

    const drafts = [
      { sequence: 1, purpose: EMAIL_PURPOSES[0], draft: sequence.email1 },
      { sequence: 2, purpose: EMAIL_PURPOSES[1], draft: sequence.email2 },
      { sequence: 3, purpose: EMAIL_PURPOSES[2], draft: sequence.email3 },
    ];

    const saved = await prisma.$transaction(
      drafts.map(({ sequence: seq, purpose, draft }) =>
        prisma.emailDraft.upsert({
          where: { leadId_sequence: { leadId: lead.id, sequence: seq } },
          update: { purpose, subject: draft.subject, body: draft.body },
          create: {
            leadId: lead.id,
            sequence: seq,
            purpose,
            subject: draft.subject,
            body: draft.body,
          },
        })
      )
    );

    return { ok: true, drafts: saved };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate emails";
    return { ok: false, error: message };
  }
}
