import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import type { Settings } from "@/generated/prisma/client";

const ENCRYPTED_FIELDS = [
  "anthropicApiKey",
  "openaiApiKey",
  "googleServiceAccountJson",
] as const;

type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

/** Fetches the singleton Settings row (creating it if missing), with secret fields decrypted. */
export async function getSettings(): Promise<Settings> {
  const row = await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return decryptSettings(row);
}

function decryptSettings(row: Settings): Settings {
  const result = { ...row };
  for (const field of ENCRYPTED_FIELDS) {
    const value = result[field as EncryptedField];
    if (value) {
      try {
        result[field as EncryptedField] = decrypt(value);
      } catch {
        // Leave as-is if it wasn't encrypted (e.g. legacy/dev data) — callers
        // that rely on the value will fail downstream instead of silently
        // corrupting other fields.
      }
    }
  }
  return result;
}

/** Partial update payload; any field present is written, secret fields are encrypted first. */
export type SettingsUpdateInput = Partial<Omit<Settings, "id" | "updatedAt">>;

export async function updateSettings(input: SettingsUpdateInput): Promise<Settings> {
  const data: Record<string, unknown> = { ...input };
  for (const field of ENCRYPTED_FIELDS) {
    const value = data[field];
    if (typeof value === "string" && value.length > 0) {
      data[field] = encrypt(value);
    }
  }

  const row = await prisma.settings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  return decryptSettings(row);
}

export const SETTINGS_SECRET_FIELDS = ENCRYPTED_FIELDS;
