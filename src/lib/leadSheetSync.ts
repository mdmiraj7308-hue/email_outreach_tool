import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { appendLeadRows, appendNoWebsiteLeadRows, updateLeadRow, type SheetLeadRow } from "@/lib/sheets";
import { format } from "date-fns";
import type { Lead, EmailDraft } from "@/generated/prisma/client";

type LeadWithDrafts = Lead & { emailDrafts: EmailDraft[] };

function draftFor(drafts: EmailDraft[], sequence: number): EmailDraft | undefined {
  return drafts.find((d) => d.sequence === sequence);
}

function leadToSheetRow(lead: LeadWithDrafts, sentFrom: string): SheetLeadRow {
  const e1 = draftFor(lead.emailDrafts, 1);
  const f1 = draftFor(lead.emailDrafts, 2);
  const f2 = draftFor(lead.emailDrafts, 3);
  return {
    date: format(lead.createdAt, "yyyy-MM-dd"),
    businessName: lead.businessName,
    website: lead.website,
    emailAddress: lead.primaryEmail,
    phone: lead.phone,
    linkedinUrl: lead.linkedinUrl,
    aboutSummary: lead.aboutSummary,
    fitScore: lead.fitScore >= 0 ? String(lead.fitScore) : "N/A",
    email1Subject: e1?.subject ?? "",
    email1Body: e1?.body ?? "",
    followup1Subject: f1?.subject ?? "",
    followup1Body: f1?.body ?? "",
    followup2Subject: f2?.subject ?? "",
    followup2Body: f2?.body ?? "",
    sentFrom,
    replyStatus: lead.replyStatus,
  };
}

export type SyncResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "lead_not_found" | "sheets_api_error"; error?: string };

/**
 * Pushes a single lead's current state to its Google Sheet row — appending
 * a new row the first time, updating the existing row on every later call
 * (enrichment complete, email sent, reply detected, etc.). Returns whether
 * it actually succeeded — callers (routes, UI) need this to surface real
 * failures like a 403 from Sheets instead of reporting false success.
 */
export async function syncLeadToSheet(leadId: string, sentFrom = "null"): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings.googleServiceAccountJson || !settings.googleSheetId) {
    return { ok: false, reason: "not_configured" };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { emailDrafts: true },
  });
  if (!lead) return { ok: false, reason: "lead_not_found" };

  const row = leadToSheetRow(lead, sentFrom);

  try {
    if (lead.sheetRowNumber) {
      await updateLeadRow(
        settings.googleServiceAccountJson,
        settings.googleSheetId,
        lead.sheetRowNumber,
        row
      );
    } else {
      const [rowNumber] = await appendLeadRows(
        settings.googleServiceAccountJson,
        settings.googleSheetId,
        [row]
      );
      if (rowNumber) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { sheetRowNumber: rowNumber, sheetRowSynced: true },
        });
      }
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Google Sheets API error";
    console.error(`[sheets] failed to sync lead ${leadId}`, err);
    return { ok: false, reason: "sheets_api_error", error: message };
  }
}

export interface CampaignSyncResult {
  total: number;
  succeeded: number;
  failed: number;
  firstError?: string;
}

export async function syncCampaignRunToSheet(campaignRunId: string): Promise<CampaignSyncResult> {
  const leads = await prisma.lead.findMany({
    where: { campaignRunId },
    select: { id: true },
  });

  let succeeded = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (const lead of leads) {
    const result = await syncLeadToSheet(lead.id);
    if (result.ok) {
      succeeded++;
    } else {
      failed++;
      if (!firstError) {
        firstError =
          result.reason === "not_configured"
            ? "Google Sheets is not configured in Settings."
            : (result.error ?? result.reason);
      }
    }
  }

  return { total: leads.length, succeeded, failed, firstError };
}

export interface NoWebsiteSyncResult {
  total: number;
  synced: number;
  error?: string;
}

/**
 * Re-syncs every NoWebsiteLead not yet marked sheetSynced — catches
 * whatever the best-effort insert-time push (in scrapeRun.ts) missed, e.g.
 * a Sheets auth/permission failure at scrape time. Safe to call repeatedly:
 * only unsynced rows are selected, and nothing gets marked synced unless
 * the append actually succeeded.
 */
export async function syncPendingNoWebsiteLeads(): Promise<NoWebsiteSyncResult> {
  const pending = await prisma.noWebsiteLead.findMany({
    where: { sheetSynced: false },
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) return { total: 0, synced: 0 };

  const settings = await getSettings();
  if (!settings.googleServiceAccountJson || !settings.googleSheetId) {
    return { total: pending.length, synced: 0, error: "Google Sheets is not configured in Settings." };
  }

  try {
    await appendNoWebsiteLeadRows(
      settings.googleServiceAccountJson,
      settings.googleSheetId,
      pending.map((r) => ({
        date: format(r.createdAt, "yyyy-MM-dd"),
        businessName: r.businessName,
        phone: r.phone,
        address: r.address,
        category: r.category,
        googleMapsUrl: r.googleMapsUrl,
      }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Google Sheets API error";
    console.error("[sheets] failed to sync pending no-website leads", err);
    return { total: pending.length, synced: 0, error: message };
  }

  await prisma.noWebsiteLead.updateMany({
    where: { id: { in: pending.map((r) => r.id) } },
    data: { sheetSynced: true },
  });

  return { total: pending.length, synced: pending.length };
}
