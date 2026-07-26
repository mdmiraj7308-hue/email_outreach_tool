import { promises as dns } from "node:dns";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailVerificationStatus = "valid" | "invalid" | "unverified";

/**
 * Free, local deliverability check: syntax + does the domain have a mail
 * server at all. This cannot confirm a specific mailbox exists (that needs
 * a paid verification API), but it catches typos and dead domains, which
 * is most of the bounce risk from scraped data.
 */
export async function verifyEmailAddress(email: string | null | undefined): Promise<EmailVerificationStatus> {
  if (!email || email === "null" || !EMAIL_REGEX.test(email)) return "invalid";

  const domain = email.split("@")[1];
  try {
    const records = await dns.resolveMx(domain);
    return records && records.length > 0 ? "valid" : "invalid";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // Domain genuinely doesn't exist / has no DNS records at all — invalid.
    // Anything else (timeout, DNS server error) is transient — don't
    // permanently block a lead over a flaky lookup.
    if (code === "ENOTFOUND" || code === "ENODATA") return "invalid";
    return "unverified";
  }
}
