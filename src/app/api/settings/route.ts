import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, updateSettings, SETTINGS_SECRET_FIELDS } from "@/lib/settings";
import { maskSecret } from "@/lib/crypto";

// Never send decrypted secrets back to the browser — mask them, and only
// overwrite the stored value when the client sends a genuinely new one.
function toClientShape(settings: Awaited<ReturnType<typeof getSettings>>) {
  const result: Record<string, unknown> = { ...settings };
  for (const field of SETTINGS_SECRET_FIELDS) {
    result[field] = settings[field] ? maskSecret(settings[field]) : "";
    result[`${field}Set`] = Boolean(settings[field]);
  }
  return result;
}

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(toClientShape(settings));
}

// The client sends its full local state on every save, which includes
// "" for an unset enum field and `null` for an unset optional number —
// neither of which `.optional()` alone accepts (it only allows undefined).
// Normalize both to undefined before validating.
const emptyStringToUndefined = (v: unknown) => (v === "" ? undefined : v);
const nullToUndefined = (v: unknown) => (v === null ? undefined : v);

const updateSchema = z
  .object({
    userName: z.string().optional(),
    userRole: z.string().optional(),
    userCompany: z.string().optional(),
    userBio: z.string().optional(),
    tonePreference: z.string().optional(),
    activeLlmProvider: z.preprocess(
      emptyStringToUndefined,
      z.enum(["anthropic", "openai"]).optional()
    ),
    anthropicApiKey: z.string().optional(),
    anthropicModel: z.string().optional(),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().optional(),
    googleServiceAccountJson: z.string().optional(),
    googleSheetId: z.string().optional(),
    globalScrapeLimit: z.preprocess(nullToUndefined, z.number().int().positive().optional()),
    globalSendLimit: z.preprocess(nullToUndefined, z.number().int().positive().optional()),
    // 0 means "no auto-reset configured" (disabled) — unlike the other
    // optional-number fields here, this one needs an explicit off state the
    // user can set from the UI, not just "leave unchanged".
    apifyResetDayOfMonth: z.preprocess(nullToUndefined, z.number().int().min(0).max(28).optional()),
    dailyCapCold: z.preprocess(nullToUndefined, z.number().int().positive().optional()),
    dailyCapFollowup2: z.preprocess(nullToUndefined, z.number().int().positive().optional()),
    dailyCapFollowup3: z.preprocess(nullToUndefined, z.number().int().positive().optional()),
    businessHoursStartHour: z.preprocess(nullToUndefined, z.number().int().min(0).max(23).optional()),
    businessHoursEndHour: z.preprocess(nullToUndefined, z.number().int().min(1).max(24).optional()),
    businessHoursTimezone: z.string().optional(),
    followupSpacingDays: z.preprocess(nullToUndefined, z.number().int().positive().optional()),
    followup2SpacingDays: z.preprocess(nullToUndefined, z.number().int().positive().optional()),
    followupEnabled: z.boolean().optional(),
    followup2Enabled: z.boolean().optional(),
    emailSystemPromptOverride: z.string().optional(),
    firstSendPauseMinSeconds: z.preprocess(nullToUndefined, z.number().int().nonnegative().optional()),
    firstSendPauseMaxSeconds: z.preprocess(nullToUndefined, z.number().int().nonnegative().optional()),
    followupPauseMinSeconds: z.preprocess(nullToUndefined, z.number().int().nonnegative().optional()),
    followupPauseMaxSeconds: z.preprocess(nullToUndefined, z.number().int().nonnegative().optional()),
    spamScoreThreshold: z.preprocess(nullToUndefined, z.number().int().min(0).max(100).optional()),
    spamScoreAction: z.preprocess(emptyStringToUndefined, z.enum(["block", "warn"]).optional()),
  })
  // secret fields ending in the masked bullet string mean "unchanged" — strip them
  .transform((data) => {
    const cleaned = { ...data };
    for (const field of SETTINGS_SECRET_FIELDS) {
      const value = cleaned[field as keyof typeof cleaned];
      if (typeof value === "string" && value.startsWith("•")) {
        delete cleaned[field as keyof typeof cleaned];
      }
    }
    return cleaned;
  });

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await updateSettings(parsed.data);
  return NextResponse.json(toClientShape(settings));
}
