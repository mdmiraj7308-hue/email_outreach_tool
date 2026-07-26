import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EnrichLeadButton } from "@/components/EnrichLeadButton";
import { EmailDraftsPanel } from "@/components/EmailDraftsPanel";
import { FollowupScheduleCard } from "@/components/FollowupScheduleCard";
import { card, statusBadgeClass, fitBadge, emailDeliverabilityBadge, badgeClass } from "@/lib/ui";
import { getDuplicateEmailLeadIds } from "@/lib/leadQualification";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm text-[var(--ink)]">{value}</dd>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      emailDrafts: { orderBy: { sequence: "asc" } },
      emailSends: {
        orderBy: { sequence: "asc" },
        include: { senderAccount: { select: { emailAddress: true } } },
      },
    },
  });
  if (!lead) notFound();

  const isNoWebsite = lead.leadType === "no_website";
  const fit = fitBadge(lead.leadType, lead.fitScore);
  const deliverability = emailDeliverabilityBadge(lead.emailVerificationStatus, lead.bounced);
  const isDuplicate = (
    await getDuplicateEmailLeadIds([{ id: lead.id, primaryEmail: lead.primaryEmail }])
  ).has(lead.id);
  // No-website leads have nothing to crawl/summarize, so they can go
  // straight to drafting the website-offer sequence; standard leads need
  // a completed About Summary first.
  const canGenerate = isNoWebsite || (!!lead.aboutSummary && lead.aboutSummary !== "null");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-light)] text-sm font-semibold text-[var(--brand-dark)]">
            {lead.businessName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">
              {lead.businessName}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={fit.className}>{fit.label}</span>
              {lead.category !== "null" && (
                <span className="text-sm text-[var(--ink-soft)]">{lead.category}</span>
              )}
            </div>
          </div>
        </div>
        <EnrichLeadButton leadId={lead.id} label="Re-enrich" />
      </div>

      <dl className={`grid grid-cols-2 gap-5 sm:grid-cols-3 ${card}`}>
        <Field label="Website" value={lead.website} />
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            Email
          </dt>
          <dd className="mt-0.5 flex items-center gap-2 text-sm text-[var(--ink)]">
            <span className="truncate">{lead.primaryEmail}</span>
            {deliverability && (
              <span className={deliverability.className}>{deliverability.label}</span>
            )}
            {isDuplicate && <span className={badgeClass("purple")}>Duplicate</span>}
          </dd>
        </div>
        <Field label="Phone" value={lead.phone} />
        <Field label="Address" value={lead.address} />
        <Field label="LinkedIn" value={lead.linkedinUrl} />
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            Enrichment
          </dt>
          <dd className="mt-1">
            <span className={statusBadgeClass(lead.enrichmentStatus)}>
              {lead.enrichmentStatus}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            Reply
          </dt>
          <dd className="mt-1">
            <span className={statusBadgeClass(lead.replyStatus === "Yes" ? "sent" : "neutral")}>
              {lead.replyStatus}
            </span>
          </dd>
        </div>
        {!isNoWebsite && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
              Team Size Estimate
            </dt>
            <dd className="mt-0.5 text-sm text-[var(--ink)]">{lead.teamSizeEstimate}</dd>
          </div>
        )}
      </dl>

      {lead.primaryEmail === "null" && (
        <p className="text-sm text-amber-700">
          No email found for this lead
          {lead.phone !== "null"
            ? ` — reach out manually via phone (${lead.phone}) instead.`
            : lead.linkedinUrl !== "null"
              ? " — no phone either, but a LinkedIn profile was found for manual outreach."
              : " and no other contact info was found."}
        </p>
      )}

      {lead.primaryEmail !== "null" && deliverability && (
        <p className="text-sm text-red-700">
          {lead.bounced
            ? "This email bounced — sending is disabled for this lead."
            : "This email failed a basic deliverability check (invalid domain or format) — sending is disabled for this lead."}
        </p>
      )}

      {lead.primaryEmail !== "null" && isDuplicate && (
        <p className="text-sm text-red-700">
          This email already received a send under a different lead (likely the same business
          scraped twice) — sending is disabled here to avoid a duplicate outreach.
        </p>
      )}

      {lead.enrichmentError && (
        <p className="text-sm text-red-600">Enrichment error: {lead.enrichmentError}</p>
      )}

      {!isNoWebsite && (
        <div className={card}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
            About Summary
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">{lead.aboutSummary}</p>
          {lead.fitReason !== "null" && (
            <p className="mt-3 border-t border-[var(--border)] pt-3 text-sm text-[var(--ink-soft)]">
              <span className="font-medium text-[var(--ink)]">Fit reasoning: </span>
              {lead.fitReason}
            </p>
          )}
        </div>
      )}

      {isNoWebsite && (
        <div className={card}>
          <p className="text-sm text-[var(--ink)]">
            No website was found for this business — drafts for this lead pitch website
            development instead of the usual AI-automation offer.
          </p>
        </div>
      )}

      <EmailDraftsPanel
        leadId={lead.id}
        drafts={lead.emailDrafts}
        sends={lead.emailSends.map((s) => ({
          sequence: s.sequence,
          status: s.status,
          senderEmail: s.senderAccount?.emailAddress ?? null,
        }))}
        canGenerate={canGenerate}
      />

      <FollowupScheduleCard
        leadId={lead.id}
        followup2ScheduledFor={lead.followup2ScheduledFor?.toISOString() ?? null}
        followup3ScheduledFor={lead.followup3ScheduledFor?.toISOString() ?? null}
      />

      {lead.emailSends.length > 0 && (
        <div className={card}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
            Send Timeline
          </h2>
          <ul className="mt-3 space-y-2">
            {lead.emailSends.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-[var(--ink)]">#{s.sequence}</span>
                  <span className={statusBadgeClass(s.status)}>{s.status}</span>
                  {s.senderAccount && (
                    <span className="text-[var(--ink-soft)]">
                      via {s.senderAccount.emailAddress}
                    </span>
                  )}
                </span>
                <span className="text-[var(--ink-soft)]">
                  {s.sentAt ? new Date(s.sentAt).toLocaleString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
