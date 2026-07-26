import { prisma } from "@/lib/prisma";

// Local, offline heuristic — this is NOT real deliverability/inbox-placement
// data (that would require a paid third-party checking service). It scans
// content for classic spam signals and gives sender accounts a rough
// reputation proxy from their own recent send outcomes.

const SPAM_TRIGGER_PHRASES = [
  "act now", "click here", "buy now", "order now", "limited time",
  "risk-free", "risk free", "no obligation", "no cost", "100% free",
  "free gift", "free trial", "free money", "free access", "guarantee",
  "guaranteed", "winner", "you've been selected", "you have been selected",
  "congratulations", "cash bonus", "double your", "earn extra cash",
  "earn money", "extra income", "make money", "work from home",
  "cancel at any time", "call now", "apply now", "urgent", "act immediately",
  "as seen on", "million dollars", "cash prize", "lowest price",
  "special promotion", "dear friend", "dear sir", "increase sales",
  "increase traffic", "meet singles", "no credit check", "no fees",
  "obligation free", "once in a lifetime", "one time offer",
  "please read", "unsubscribe", "viagra", "weight loss", "casino",
  "lottery", "$$$", "not spam", "opt in", "important information regarding",
  "this isn't a scam", "this isn't spam",
] as const;

export interface SpamCheckResult {
  score: number; // 0-100, higher = worse
  flags: string[];
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export function scoreEmailContent(subject: string, body: string): SpamCheckResult {
  const flags: string[] = [];
  let points = 0;

  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();

  let subjectHits = 0;
  let bodyHits = 0;
  for (const phrase of SPAM_TRIGGER_PHRASES) {
    subjectHits += countOccurrences(subjectLower, phrase);
    bodyHits += countOccurrences(bodyLower, phrase);
  }
  if (subjectHits > 0) {
    points += subjectHits * 12; // subject hits weigh 2x a body hit
    flags.push(`${subjectHits} spam-trigger phrase${subjectHits > 1 ? "s" : ""} in subject`);
  }
  if (bodyHits > 0) {
    points += bodyHits * 6;
    flags.push(`${bodyHits} spam-trigger phrase${bodyHits > 1 ? "s" : ""} in body`);
  }

  const subjectWords = subject.split(/\s+/).filter((w) => w.length > 1);
  const capsWords = subjectWords.filter((w) => w === w.toUpperCase() && /[A-Z]/.test(w));
  const capsRatio = subjectWords.length > 0 ? capsWords.length / subjectWords.length : 0;
  if (capsRatio > 0.3) {
    points += 20;
    flags.push(`subject is ${Math.round(capsRatio * 100)}% capitalized words`);
  }

  const bangRuns = body.match(/!{2,}/g) ?? [];
  const questionRuns = body.match(/\?{2,}/g) ?? [];
  const excessivePunct = bangRuns.length + questionRuns.length + (subject.match(/!{2,}|\?{2,}/g)?.length ?? 0);
  if (excessivePunct > 0) {
    points += excessivePunct * 8;
    flags.push(`${excessivePunct} run${excessivePunct > 1 ? "s" : ""} of repeated !/? punctuation`);
  }

  if (subject.length > 80) {
    points += 5;
    flags.push("subject is unusually long (>80 chars)");
  }

  const urlCount = (body.match(/https?:\/\//g) ?? []).length;
  if (urlCount > 2) {
    points += (urlCount - 2) * 10;
    flags.push(`${urlCount} raw links in body`);
  }

  const score = Math.max(0, Math.min(100, Math.round(points)));
  return { score, flags };
}

/**
 * Rough, local reputation proxy for a sender account: blends the average
 * content spam-score of its recent sends with its recent failure rate.
 * Not real deliverability data — there is no local signal for that.
 */
export async function computeSenderSpamScore(senderAccountId: string): Promise<number> {
  const recentSends = await prisma.emailSend.findMany({
    where: { senderAccountId, status: { in: ["sent", "failed"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { status: true, spamCheckScore: true },
  });

  if (recentSends.length === 0) return 0;

  const scored = recentSends.filter((s) => s.spamCheckScore !== null);
  const avgContentScore =
    scored.length > 0
      ? scored.reduce((sum, s) => sum + (s.spamCheckScore ?? 0), 0) / scored.length
      : 0;

  const failedCount = recentSends.filter((s) => s.status === "failed").length;
  const failureRate = failedCount / recentSends.length;

  const blended = avgContentScore * 0.7 + failureRate * 100 * 0.3;
  return Math.max(0, Math.min(100, Math.round(blended)));
}

/** Recomputes and persists spamScore for a sender account. */
export async function refreshSenderSpamScore(senderAccountId: string): Promise<number> {
  const score = await computeSenderSpamScore(senderAccountId);
  await prisma.senderAccount.update({
    where: { id: senderAccountId },
    data: { spamScore: score, spamScoreUpdatedAt: new Date() },
  });
  return score;
}
