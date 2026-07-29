import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { QUALIFIED_LEAD_WHERE, filterOutDuplicateEmails } from "@/lib/leadQualification";
import { nextBusinessSlot, nextBusinessDayAfter } from "@/lib/businessHours";
import { format, startOfDay, endOfDay } from "date-fns";

/**
 * The global "fresh" pool: qualified leads that have never been part of any
 * sending campaign before (draft or confirmed) — no extra flag needed,
 * membership in SendingCampaignLead IS the "already used" marker. Hottest
 * (highest fit score) first, oldest as tiebreak. Drafts are NOT required to
 * already exist here — a campaign can be created first, audited, then
 * drafted via the "Write emails + 2 follow-ups" action on its own page.
 */
async function getFreshLeadCandidates() {
  const candidates = await prisma.lead.findMany({
    where: {
      ...QUALIFIED_LEAD_WHERE,
      sendingCampaignLeads: { none: {} },
    },
    select: { id: true, primaryEmail: true, fitScore: true, createdAt: true },
    orderBy: [{ fitScore: "desc" }, { createdAt: "asc" }],
  });
  return filterOutDuplicateEmails(candidates);
}

export async function getFreshLeadPool(limit: number) {
  const deduped = await getFreshLeadCandidates();
  return deduped.slice(0, limit);
}

/** How many leads a "Create Campaign" click could actually draw from right now — shown in the UI before the user picks a count. */
export async function getFreshLeadPoolCount(): Promise<number> {
  const deduped = await getFreshLeadCandidates();
  return deduped.length;
}

/** Evenly distributes N leads across active sender accounts, round-robin (remainder spread one-at-a-time, not piled on the last account). */
export function assignAccountsRoundRobin<T>(items: T[], accountIds: string[]): Map<T, string> {
  const assignment = new Map<T, string>();
  items.forEach((item, i) => {
    assignment.set(item, accountIds[i % accountIds.length]);
  });
  return assignment;
}

export interface CreateCampaignResult {
  ok: true;
  campaignId: string;
  leadCount: number;
}
export interface CreateCampaignError {
  ok: false;
  error: string;
}

export async function createSendingCampaign(
  targetCount: number
): Promise<CreateCampaignResult | CreateCampaignError> {
  const accounts = await prisma.senderAccount.findMany({ where: { isActive: true } });
  if (accounts.length === 0) {
    return { ok: false, error: "No active Gmail sender accounts connected." };
  }

  const pool = await getFreshLeadPool(targetCount);
  if (pool.length === 0) {
    return { ok: false, error: "No fresh qualified leads available — nothing left to draw from." };
  }

  const accountIds = accounts.map((a) => a.id);
  const assignment = assignAccountsRoundRobin(pool, accountIds);

  const campaign = await prisma.sendingCampaign.create({
    data: {
      label: `${format(new Date(), "yyyy-MM-dd")} — ${pool.length} leads`,
      targetCount,
      status: "draft",
    },
  });

  // A single bulk insert instead of an array-form $transaction of N
  // individual create() calls — that pattern already timed out in
  // production once (see insertLeadsFromDataset in scrapeRun.ts) once N got
  // large enough that N round-trips to Supabase exceeded Prisma's default
  // 5s interactive-transaction timeout, throwing uncaught and returning an
  // empty response body (surfaced client-side as "Unexpected end of JSON
  // input"). Same fix here.
  await prisma.sendingCampaignLead.createMany({
    data: pool.map((lead) => ({
      sendingCampaignId: campaign.id,
      leadId: lead.id,
      senderAccountId: assignment.get(lead)!,
    })),
  });

  return { ok: true, campaignId: campaign.id, leadCount: pool.length };
}

export interface ConfirmCampaignResult {
  ok: true;
  scheduled: number;
}
export interface ConfirmCampaignError {
  ok: false;
  error: string;
}

/**
 * Locks in a draft campaign: creates the sequence-1 EmailSend for every
 * member lead with its pre-assigned senderAccountId already set (never
 * decided lazily), scheduled inside business hours. Leads assigned to the
 * same account are distributed across enough business days that none of
 * them individually exceeds that account's daily cold cap — day 1 gets up
 * to the cap, the overflow rolls to day 2's business-hours start, and so on.
 */
export async function confirmSendingCampaign(
  campaignId: string
): Promise<ConfirmCampaignResult | ConfirmCampaignError> {
  const campaign = await prisma.sendingCampaign.findUnique({
    where: { id: campaignId },
    include: { leads: { include: { lead: true, senderAccount: true } } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found" };
  if (campaign.status !== "draft") return { ok: false, error: `Campaign is already ${campaign.status}` };

  // Drafts are no longer guaranteed to exist by the time a campaign is
  // created (see getFreshLeadCandidates) — writing them now happens via a
  // separate "Write emails + 2 follow-ups" action on this campaign's own
  // page, after the lead list has been audited. Block confirming outright
  // if any lead hasn't been drafted yet, rather than silently skipping it —
  // a silently-skipped lead would be stranded in a confirmed campaign with
  // no draft and no way to ever send or remove it individually.
  const leadIds = campaign.leads.map((l) => l.leadId);
  const draftCounts = await prisma.emailDraft.groupBy({
    by: ["leadId"],
    where: { leadId: { in: leadIds } },
    _count: { _all: true },
  });
  const fullyDraftedLeadIds = new Set(draftCounts.filter((d) => d._count._all >= 3).map((d) => d.leadId));
  const missingDraftsCount = leadIds.filter((id) => !fullyDraftedLeadIds.has(id)).length;
  if (missingDraftsCount > 0) {
    return {
      ok: false,
      error: `${missingDraftsCount} lead${missingDraftsCount === 1 ? "" : "s"} still need${missingDraftsCount === 1 ? "s" : ""} emails written — click "Write emails + 2 follow-ups" first.`,
    };
  }

  const settings = await getSettings();
  const startHour = settings.businessHoursStartHour;
  const endHour = settings.businessHoursEndHour;
  const tz = settings.businessHoursTimezone;

  // Real count (actual sends via DailySendCounter + anything already
  // "scheduled" for that exact resolved calendar day from an earlier
  // confirmed campaign) for one account on one resolved business-hours
  // slot. Queried lazily per (account, day) as the walk below reaches it,
  // and cached so repeated leads landing on the same day don't re-query.
  // This is a best-effort scheduling estimate, not the sole enforcement —
  // sendUsingAccount in sendQueue.ts re-checks the real cap again at actual
  // dispatch time and defers anything over it, so a cap is never truly
  // exceeded even if this estimate is ever wrong.
  async function getExistingCountForSlot(accountId: string, resolvedDate: Date): Promise<number> {
    const dateKey = format(resolvedDate, "yyyy-MM-dd");
    const [counter, scheduledCount] = await Promise.all([
      prisma.dailySendCounter.findUnique({
        where: { senderAccountId_date_sequence: { senderAccountId: accountId, date: dateKey, sequence: 1 } },
      }),
      prisma.emailSend.count({
        where: {
          senderAccountId: accountId,
          sequence: 1,
          status: "scheduled",
          scheduledFor: { gte: startOfDay(resolvedDate), lte: endOfDay(resolvedDate) },
        },
      }),
    ]);
    return (counter?.count ?? 0) + scheduledCount;
  }

  const slotCountCache = new Map<string, number>(); // key: `${accountId}|${yyyy-MM-dd}`
  const currentSlotByAccount = new Map<string, Date>();

  const creates: { leadId: string; emailDraftId: string; senderAccountId: string; scheduledFor: Date }[] = [];

  for (const campaignLead of campaign.leads) {
    const draft = await prisma.emailDraft.findUnique({
      where: { leadId_sequence: { leadId: campaignLead.leadId, sequence: 1 } },
    });
    if (!draft) continue; // guarded above — unreachable, kept as a defensive fallback

    const existingSend = await prisma.emailSend.findUnique({ where: { emailDraftId: draft.id } });
    if (existingSend) continue; // already scheduled/sent somehow — don't double-create

    const accountId = campaignLead.senderAccountId;
    const cap = campaignLead.senderAccount.dailyCapCold ?? settings.dailyCapCold;

    // Walk forward one real business day at a time (not a raw day-offset —
    // that can collapse multiple offsets onto the same resolved calendar
    // day whenever a weekend bump is involved) until a day with capacity.
    let slot = currentSlotByAccount.get(accountId) ?? nextBusinessSlot(new Date(), startHour, endHour, tz);
    for (;;) {
      const key = `${accountId}|${format(slot, "yyyy-MM-dd")}`;
      let used = slotCountCache.get(key);
      if (used === undefined) used = await getExistingCountForSlot(accountId, slot);
      if (used < cap) {
        slotCountCache.set(key, used + 1);
        break;
      }
      slot = nextBusinessDayAfter(slot, startHour, endHour, tz);
    }
    currentSlotByAccount.set(accountId, slot);

    creates.push({ leadId: campaignLead.leadId, emailDraftId: draft.id, senderAccountId: accountId, scheduledFor: slot });
  }

  await prisma.$transaction(
    creates.map((c) =>
      prisma.emailSend.create({
        data: {
          leadId: c.leadId,
          emailDraftId: c.emailDraftId,
          senderAccountId: c.senderAccountId,
          sequence: 1,
          status: "scheduled",
          scheduledFor: c.scheduledFor,
        },
      })
    )
  );

  await prisma.sendingCampaign.update({
    where: { id: campaignId },
    data: { status: "confirmed", confirmedAt: new Date() },
  });

  return { ok: true, scheduled: creates.length };
}
