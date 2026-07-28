import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

/**
 * Resets every ApifyAccount's leadsScraped counter to 0 on the configured
 * day of month — leadsScraped is otherwise a running lifetime total with no
 * built-in reset, so an account that ever crosses its monthlyLimit stays
 * permanently excluded from scraping until this fires (or someone manually
 * raises its limit).
 *
 * Guards against double-firing: apifyResetLastRunAt is only updated once
 * the reset actually runs, and is compared by calendar month+year rather
 * than an exact day match — a cron tick that lands a day or two late (e.g.
 * the app was down) still fires once, rather than silently skipping that
 * month entirely.
 */
export async function runApifyResetIfDue(): Promise<void> {
  const settings = await getSettings();
  const resetDay = settings.apifyResetDayOfMonth;
  if (!resetDay) return;

  const now = new Date();
  if (now.getDate() < resetDay) return;

  const last = settings.apifyResetLastRunAt;
  const alreadyRanThisMonth =
    last && last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth();
  if (alreadyRanThisMonth) return;

  await prisma.$transaction([
    prisma.apifyAccount.updateMany({ data: { leadsScraped: 0 } }),
    prisma.settings.update({ where: { id: 1 }, data: { apifyResetLastRunAt: now } }),
  ]);
}
