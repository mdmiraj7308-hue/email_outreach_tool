import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { GMAIL_SCOPES } from "@/lib/constants";
import type { SenderAccount } from "@/generated/prisma/client";

function getRedirectUri(): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base}/api/gmail/oauth/callback`;
}

function getOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not set in .env.local."
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

export function buildAuthUrl(): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh token on every connect, even for a re-auth
    scope: GMAIL_SCOPES,
  });
}

export interface ExchangedAccount {
  emailAddress: string;
  refreshToken: string;
  accessToken: string;
  expiryDate: Date;
}

export async function exchangeCodeForAccount(code: string): Promise<ExchangedAccount> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect this account's access at " +
        "https://myaccount.google.com/permissions and try connecting again."
    );
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) {
    throw new Error("Could not determine the Gmail address for this account.");
  }

  return {
    emailAddress: data.email,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? "",
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
  };
}

export async function upsertSenderAccount(account: ExchangedAccount) {
  return prisma.senderAccount.upsert({
    where: { emailAddress: account.emailAddress },
    update: {
      refreshToken: encrypt(account.refreshToken),
      accessToken: encrypt(account.accessToken),
      tokenExpiry: account.expiryDate,
      isActive: true,
    },
    create: {
      emailAddress: account.emailAddress,
      refreshToken: encrypt(account.refreshToken),
      accessToken: encrypt(account.accessToken),
      tokenExpiry: account.expiryDate,
    },
  });
}

const REFRESH_MARGIN_MS = 60_000;

/** Returns a valid access token for the account, refreshing it first if it's expired/near-expiry. */
export async function ensureFreshAccessToken(account: SenderAccount): Promise<string> {
  const isExpired =
    !account.accessToken || !account.tokenExpiry || account.tokenExpiry.getTime() - REFRESH_MARGIN_MS < Date.now();

  if (!isExpired && account.accessToken) {
    return decrypt(account.accessToken);
  }

  const client = getOAuthClient();
  client.setCredentials({ refresh_token: decrypt(account.refreshToken) });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error(`Failed to refresh Gmail access token for ${account.emailAddress}`);
  }

  await prisma.senderAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encrypt(credentials.access_token),
      tokenExpiry: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600_000),
    },
  });

  return credentials.access_token;
}
