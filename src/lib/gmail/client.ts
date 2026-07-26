import { google, gmail_v1 } from "googleapis";

function buildGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface SendPlainEmailParams {
  accessToken: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  /** Set for follow-ups so the message threads with the original. */
  inReplyToMessageId?: string;
  threadId?: string;
}

export interface SendResult {
  messageId: string;
  threadId: string;
}

export async function sendPlainEmail(params: SendPlainEmailParams): Promise<SendResult> {
  const gmail = buildGmailClient(params.accessToken);

  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
  ];
  if (params.inReplyToMessageId) {
    headers.push(`In-Reply-To: <${params.inReplyToMessageId}>`);
    headers.push(`References: <${params.inReplyToMessageId}>`);
  }

  const raw = encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${params.body}`);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: params.threadId,
    },
  });

  if (!res.data.id || !res.data.threadId) {
    throw new Error("Gmail send response was missing message/thread id");
  }

  return { messageId: res.data.id, threadId: res.data.threadId };
}

export interface ThreadHasReplyParams {
  accessToken: string;
  threadId: string;
  ownEmailAddress: string;
  sinceMs: number;
}

/**
 * Checks the sending account's own inbox for a delivery-failure
 * notification (bounce) mentioning the given recipient address, sent
 * after the given time. Bounces land as a new message from
 * mailer-daemon/postmaster in the sender's own mailbox, not as a reply on
 * the original thread — this is a separate search, not thread inspection.
 */
export async function findBounceForRecipient(
  accessToken: string,
  recipientEmail: string,
  sinceMs: number
): Promise<boolean> {
  const gmail = buildGmailClient(accessToken);
  const daysSince = Math.max(1, Math.ceil((Date.now() - sinceMs) / (24 * 60 * 60 * 1000)) + 1);
  const query = `from:(mailer-daemon OR postmaster OR "mail delivery subsystem") "${recipientEmail}" newer_than:${daysSince}d`;

  const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 5 });
  const messages = res.data.messages ?? [];
  if (messages.length === 0) return false;

  // Confirm at least one match is actually after the send (list results can
  // include slightly older matches for a common query).
  for (const m of messages) {
    if (!m.id) continue;
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["Date"],
    });
    const internalDate = Number(detail.data.internalDate ?? 0);
    if (internalDate >= sinceMs) return true;
  }
  return false;
}

/** Checks whether a thread has any message from someone other than the sending account, after a given time. */
export async function threadHasReplyFrom(params: ThreadHasReplyParams): Promise<boolean> {
  const gmail = buildGmailClient(params.accessToken);
  const thread = await gmail.users.threads.get({ userId: "me", id: params.threadId });
  const messages = thread.data.messages ?? [];

  for (const message of messages) {
    const internalDate = Number(message.internalDate ?? 0);
    if (internalDate <= params.sinceMs) continue;

    const fromHeader = message.payload?.headers?.find((h) => h.name?.toLowerCase() === "from");
    const fromValue = fromHeader?.value ?? "";
    if (!fromValue.toLowerCase().includes(params.ownEmailAddress.toLowerCase())) {
      return true;
    }
  }
  return false;
}
