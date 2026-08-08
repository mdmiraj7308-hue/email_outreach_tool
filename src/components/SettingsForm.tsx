"use client";

import { useEffect, useState } from "react";
import { GmailAccountsTab } from "@/components/GmailAccountsTab";
import { ApifyAccountsTab } from "@/components/ApifyAccountsTab";
import { btnPrimary, card, input as inputClass } from "@/lib/ui";

interface SettingsState {
  userName: string;
  userRole: string;
  userCompany: string;
  userBio: string;
  tonePreference: string;
  activeLlmProvider: "anthropic" | "openai" | "";
  anthropicApiKey: string;
  anthropicApiKeySet: boolean;
  anthropicModel: string;
  openaiApiKey: string;
  openaiApiKeySet: boolean;
  openaiModel: string;
  googleServiceAccountJson: string;
  googleServiceAccountJsonSet: boolean;
  googleSheetId: string;
  globalScrapeLimit: number;
  globalSendLimit: number;
  dailyCapCold: number;
  dailyCapFollowup2: number;
  dailyCapFollowup3: number;
  businessHoursStartHour: number;
  businessHoursEndHour: number;
  businessHoursTimezone: string;
  followupSpacingDays: number;
  followup2SpacingDays: number | null;
  followupEnabled: boolean;
  followup2Enabled: boolean;
  emailSystemPromptOverride: string;
  firstSendPauseMinSeconds: number;
  firstSendPauseMaxSeconds: number;
  followupPauseMinSeconds: number;
  followupPauseMaxSeconds: number;
  spamScoreThreshold: number;
  spamScoreAction: "block" | "warn";
}

const TABS = ["Profile", "Apify", "LLM", "Google Sheets", "Gmail Accounts", "Limits"] as const;
type Tab = (typeof TABS)[number];

const emptyState: SettingsState = {
  userName: "",
  userRole: "",
  userCompany: "",
  userBio: "",
  tonePreference: "",
  activeLlmProvider: "",
  anthropicApiKey: "",
  anthropicApiKeySet: false,
  anthropicModel: "",
  openaiApiKey: "",
  openaiApiKeySet: false,
  openaiModel: "",
  googleServiceAccountJson: "",
  googleServiceAccountJsonSet: false,
  googleSheetId: "",
  globalScrapeLimit: 100,
  globalSendLimit: 50,
  dailyCapCold: 20,
  dailyCapFollowup2: 20,
  dailyCapFollowup3: 20,
  businessHoursStartHour: 9,
  businessHoursEndHour: 17,
  businessHoursTimezone: "America/New_York",
  followupSpacingDays: 3,
  followup2SpacingDays: null,
  followupEnabled: true,
  followup2Enabled: true,
  emailSystemPromptOverride: "",
  firstSendPauseMinSeconds: 5,
  firstSendPauseMaxSeconds: 120,
  followupPauseMinSeconds: 5,
  followupPauseMaxSeconds: 100,
  spamScoreThreshold: 70,
  spamScoreAction: "block",
};

function getServiceAccountEmailPreview(json: string): string | null {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed.client_email === "string" ? parsed.client_email : null;
  } catch {
    return null;
  }
}

export function SettingsForm() {
  const [tab, setTab] = useState<Tab>("Profile");
  const [state, setState] = useState<SettingsState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: Record<string, unknown>) => {
        // API returns nullable DB columns as `null`; controlled string
        // inputs need "" instead, or React logs a null-value warning.
        const sanitized = { ...data };
        for (const [key, value] of Object.entries(sanitized)) {
          if (value === null && typeof emptyState[key as keyof SettingsState] === "string") {
            sanitized[key] = "";
          }
        }
        setState((s) => ({ ...s, ...sanitized }));
      })
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error));
      setState((s) => ({ ...s, ...data }));
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? `Error: ${err.message}` : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-[var(--ink-soft)]">Loading…</p>;

  return (
    <div className="flex gap-10">
      <nav className="w-56 shrink-0 space-y-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`block w-full rounded-xl px-4 py-3 text-left text-base font-medium transition ${
              tab === t
                ? "bg-[var(--brand-light)] text-[var(--brand-dark)]"
                : "text-[var(--ink-soft)] hover:bg-neutral-100 hover:text-[var(--ink)]"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className={`max-w-2xl flex-1 space-y-5 ${card}`}>
        {tab === "Profile" && (
          <>
            <TextField
              label="Your name"
              placeholder="e.g. Miraj Islam"
              value={state.userName}
              onChange={(v) => update("userName", v)}
            />
            <TextField
              label="What service do you provide"
              placeholder="e.g. AI automation & custom software for small businesses"
              value={state.userRole}
              onChange={(v) => update("userRole", v)}
            />
            <TextAreaField
              label="About you & your business, in detail"
              placeholder="The more detail here, the more personal the AI can make your emails — who you help, how you work, what makes you different, past results, etc."
              value={state.userBio}
              onChange={(v) => update("userBio", v)}
              rows={8}
            />
            <TextAreaField
              label="Default email-writing instructions (optional)"
              placeholder="Extra instructions for how the AI should write your emails, e.g. tone, structure, things to always/never mention. Applied to every batch unless you override it for a specific run."
              value={state.emailSystemPromptOverride}
              onChange={(v) => update("emailSystemPromptOverride", v)}
              rows={5}
            />
          </>
        )}

        {tab === "Apify" && <ApifyAccountsTab />}

        {tab === "LLM" && (
          <>
            <div className="space-y-1.5">
              <label className="text-base font-medium text-[var(--ink)]">Active provider</label>
              <div className="flex gap-2">
                {(["anthropic", "openai"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => update("activeLlmProvider", p)}
                    className={`rounded-full px-5 py-2 text-base font-medium transition ${
                      state.activeLlmProvider === p
                        ? "bg-[var(--brand)] text-white"
                        : "border border-[var(--border)] text-[var(--ink-soft)] hover:bg-neutral-50"
                    }`}
                  >
                    {p === "anthropic" ? "Anthropic" : "OpenAI"}
                  </button>
                ))}
              </div>
            </div>
            <SecretField
              label="Anthropic API key"
              value={state.anthropicApiKey}
              isSet={state.anthropicApiKeySet}
              onChange={(v) => update("anthropicApiKey", v)}
            />
            <TextField
              label="Anthropic model"
              placeholder="claude-sonnet-5"
              value={state.anthropicModel}
              onChange={(v) => update("anthropicModel", v)}
            />
            <SecretField
              label="OpenAI API key"
              value={state.openaiApiKey}
              isSet={state.openaiApiKeySet}
              onChange={(v) => update("openaiApiKey", v)}
            />
            <TextField
              label="OpenAI model"
              placeholder="gpt-4.1"
              value={state.openaiModel}
              onChange={(v) => update("openaiModel", v)}
            />
          </>
        )}

        {tab === "Google Sheets" && (
          <>
            <SecretField
              label="Service account JSON key"
              value={state.googleServiceAccountJson}
              isSet={state.googleServiceAccountJsonSet}
              onChange={(v) => update("googleServiceAccountJson", v)}
              textarea
            />
            {!state.googleServiceAccountJson.startsWith("•") &&
              getServiceAccountEmailPreview(state.googleServiceAccountJson) && (
                <p className="text-xs text-[var(--ink-soft)]">
                  Share your sheet (Editor access) with:{" "}
                  <span className="font-mono">
                    {getServiceAccountEmailPreview(state.googleServiceAccountJson)}
                  </span>
                </p>
              )}
            <TextField
              label="Google Sheet ID"
              value={state.googleSheetId}
              onChange={(v) => update("googleSheetId", v)}
            />
          </>
        )}

        {tab === "Gmail Accounts" && <GmailAccountsTab />}

        {tab === "Limits" && (
          <>
            <NumberField
              label="Global scrape limit (leads per run)"
              value={state.globalScrapeLimit}
              onChange={(v) => update("globalScrapeLimit", v)}
            />
            <NumberField
              label="Global send limit (emails per day, all accounts)"
              value={state.globalSendLimit}
              onChange={(v) => update("globalSendLimit", v)}
            />
            <div className="rounded-xl border border-[var(--border)] p-3.5">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                Per-account daily send caps
              </p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                Independent daily budgets per sequence stage — an account can send up to its cold
                cap AND up to its follow-up-2 cap AND up to its follow-up-3 cap on the same day.
                Any individual account can override these in Gmail Accounts.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <NumberField
                  label="Cold emails / day"
                  value={state.dailyCapCold}
                  onChange={(v) => update("dailyCapCold", v)}
                />
                <NumberField
                  label="Follow-up 2 / day"
                  value={state.dailyCapFollowup2}
                  onChange={(v) => update("dailyCapFollowup2", v)}
                />
                <NumberField
                  label="Follow-up 3 / day"
                  value={state.dailyCapFollowup3}
                  onChange={(v) => update("dailyCapFollowup3", v)}
                />
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] p-3.5">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                Business-hours sending window
              </p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                Automatically scheduled sends (sending campaigns, follow-ups) are bumped to land
                inside this window on weekdays. Manual "Send Now" is exempt.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <NumberField
                  label="Start hour (0-23)"
                  value={state.businessHoursStartHour}
                  onChange={(v) => update("businessHoursStartHour", v)}
                />
                <NumberField
                  label="End hour (1-24)"
                  value={state.businessHoursEndHour}
                  onChange={(v) => update("businessHoursEndHour", v)}
                />
                <TextField
                  label="Timezone (IANA)"
                  value={state.businessHoursTimezone}
                  onChange={(v) => update("businessHoursTimezone", v)}
                  placeholder="America/New_York"
                />
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] p-3.5">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                Follow-up schedule (default)
              </p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                How many days to wait before each follow-up, by default. Any individual lead
                can override this with an exact date/time from its own page or Today's Sending.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <NumberField
                    label="Days: email 1 → follow-up 1"
                    value={state.followupSpacingDays}
                    onChange={(v) => update("followupSpacingDays", v)}
                  />
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={state.followupEnabled}
                      onChange={(e) => update("followupEnabled", e.target.checked)}
                    />
                    Send follow-up 1
                  </label>
                </div>
                <div className="space-y-1.5">
                  <NumberField
                    label="Days: follow-up 1 → follow-up 2 (optional, defaults to above)"
                    value={state.followup2SpacingDays ?? state.followupSpacingDays}
                    onChange={(v) => update("followup2SpacingDays", v)}
                  />
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={state.followup2Enabled}
                      onChange={(e) => update("followup2Enabled", e.target.checked)}
                    />
                    Send follow-up 2
                  </label>
                </div>
              </div>
              {!state.followupEnabled && (
                <p className="mt-2 text-xs text-amber-600">
                  Follow-up 1 is off — follow-up 2 won&apos;t send either, since it only fires
                  after follow-up 1 does.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="First-email pause: min seconds"
                value={state.firstSendPauseMinSeconds}
                onChange={(v) => update("firstSendPauseMinSeconds", v)}
              />
              <NumberField
                label="First-email pause: max seconds"
                value={state.firstSendPauseMaxSeconds}
                onChange={(v) => update("firstSendPauseMaxSeconds", v)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="Follow-up pause: min seconds"
                value={state.followupPauseMinSeconds}
                onChange={(v) => update("followupPauseMinSeconds", v)}
              />
              <NumberField
                label="Follow-up pause: max seconds"
                value={state.followupPauseMaxSeconds}
                onChange={(v) => update("followupPauseMaxSeconds", v)}
              />
            </div>
            <NumberField
              label="Spam-score block threshold (0-100, higher = worse)"
              value={state.spamScoreThreshold}
              onChange={(v) => update("spamScoreThreshold", v)}
            />
            <div className="space-y-1.5">
              <label className="text-base font-medium text-[var(--ink)]">
                Action when spam score is over the threshold
              </label>
              <div className="flex gap-2">
                {(["block", "warn"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => update("spamScoreAction", a)}
                    className={`rounded-full px-5 py-2 text-base font-medium transition ${
                      state.spamScoreAction === a
                        ? "bg-[var(--brand)] text-white"
                        : "border border-[var(--border)] text-[var(--ink-soft)] hover:bg-neutral-50"
                    }`}
                  >
                    {a === "block" ? "Block the send" : "Warn only"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
          {message && <span className="text-sm text-[var(--ink-soft)]">{message}</span>}
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-base font-medium text-[var(--ink)]">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-base font-medium text-[var(--ink)]">{label}</label>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={inputClass}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-base font-medium text-[var(--ink)]">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputClass}
      />
    </div>
  );
}

function SecretField({
  label,
  value,
  isSet,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  isSet: boolean;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  const Comp = textarea ? "textarea" : "input";
  return (
    <div className="space-y-1.5">
      <label className="text-base font-medium text-[var(--ink)]">
        {label}{" "}
        {isSet && (
          <span className="ml-1 rounded-full bg-[var(--brand-light)] px-2 py-0.5 text-xs font-medium text-[var(--brand-dark)]">
            configured
          </span>
        )}
      </label>
      <Comp
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (value.startsWith("•")) onChange("");
        }}
        rows={textarea ? 6 : undefined}
        placeholder={isSet ? "Leave unchanged, or paste a new value to replace it" : ""}
        className={`${inputClass} font-mono`}
      />
    </div>
  );
}
