import { google, sheets_v4 } from "googleapis";
import { GOOGLE_SHEET_HEADERS, NO_WEBSITE_SHEET_HEADERS, NO_WEBSITE_SHEET_TAB_NAME } from "@/lib/constants";

export interface SheetLeadRow {
  date: string; // YYYY-MM-DD
  businessName: string;
  website: string;
  emailAddress: string;
  phone: string;
  linkedinUrl: string;
  aboutSummary: string;
  fitScore: string;
  email1Subject: string;
  email1Body: string;
  followup1Subject: string;
  followup1Body: string;
  followup2Subject: string;
  followup2Body: string;
  sentFrom: string;
  replyStatus: string;
}

function rowToValues(row: SheetLeadRow): string[] {
  return [
    row.date,
    row.businessName,
    row.website,
    row.emailAddress,
    row.phone,
    row.linkedinUrl,
    row.aboutSummary,
    row.fitScore,
    row.email1Subject,
    row.email1Body,
    row.followup1Subject,
    row.followup1Body,
    row.followup2Subject,
    row.followup2Body,
    row.sentFrom,
    row.replyStatus,
  ];
}

function getClient(serviceAccountJson: string): sheets_v4.Sheets {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// A1-notation range syntax requires a sheet name to be single-quoted if it
// contains anything other than letters/digits/underscore (e.g. "Sheet 1",
// "1st list"), with internal quotes doubled.
function quoteSheetName(name: string): string {
  if (/^\w+$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

/**
 * Resolves the actual sheet/tab to write to — always the spreadsheet's
 * first tab, whatever it's named. We write into whatever tab the user
 * already has (respecting any header row they've already set up) rather
 * than creating a separate tab of our own, which would just be a second,
 * confusing tab alongside their real one.
 */
async function getPrimarySheetName(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<string> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title,sheets.properties.index",
  });
  const sheetList = meta.data.sheets ?? [];
  const first = [...sheetList].sort(
    (a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0)
  )[0];
  const title = first?.properties?.title;
  if (!title) {
    throw new Error("The connected Google Sheet has no tabs at all.");
  }
  return title;
}

// Turns a 0-indexed column number into its A1 column letter (only needs to
// cover A-Z for this sheet's fixed 16-column layout).
function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

async function ensureHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
) {
  const quoted = quoteSheetName(sheetName);
  const lastCol = columnLetter(GOOGLE_SHEET_HEADERS.length - 1);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoted}!A1:${lastCol}1`,
  });
  const firstRow = res.data.values?.[0] ?? [];
  const matches =
    firstRow.length === GOOGLE_SHEET_HEADERS.length &&
    firstRow.every((cell, i) => cell === GOOGLE_SHEET_HEADERS[i]);
  if (!matches) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoted}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [GOOGLE_SHEET_HEADERS] },
    });
  }
}

/**
 * Appends lead rows to the sheet and returns the 1-indexed row number each
 * ended up at, so later enrichment/send updates can target them directly.
 */
export async function appendLeadRows(
  serviceAccountJson: string,
  spreadsheetId: string,
  rows: SheetLeadRow[]
): Promise<number[]> {
  if (rows.length === 0) return [];
  const sheets = getClient(serviceAccountJson);
  const sheetName = await getPrimarySheetName(sheets, spreadsheetId);
  await ensureHeaderRow(sheets, spreadsheetId, sheetName);

  const quoted = quoteSheetName(sheetName);
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoted}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows.map(rowToValues) },
  });

  const updatedRange = res.data.updates?.updatedRange;
  if (!updatedRange) return [];
  // updatedRange looks like "Sheet1!A5:I7" (or 'My Sheet'!A5:I7) — parse
  // the starting row number after the last "!".
  const afterBang = updatedRange.slice(updatedRange.lastIndexOf("!") + 1);
  const match = afterBang.match(/^[A-Z]+(\d+):/);
  const startRow = match ? parseInt(match[1], 10) : null;
  if (startRow === null) return [];
  return rows.map((_, i) => startRow + i);
}

/** Overwrites a single already-appended row (targeted update, no re-append). */
export async function updateLeadRow(
  serviceAccountJson: string,
  spreadsheetId: string,
  rowNumber: number,
  row: SheetLeadRow
): Promise<void> {
  const sheets = getClient(serviceAccountJson);
  const sheetName = await getPrimarySheetName(sheets, spreadsheetId);
  await ensureHeaderRow(sheets, spreadsheetId, sheetName);
  const quoted = quoteSheetName(sheetName);
  const lastCol = columnLetter(GOOGLE_SHEET_HEADERS.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoted}!A${rowNumber}:${lastCol}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [rowToValues(row)] },
  });
}

/**
 * Resolves the primary tab's numeric sheetId (gid), needed for
 * deleteDimension requests — distinct from its title, which the other
 * helpers use for A1-notation ranges.
 */
async function getPrimarySheetId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.sheetId,sheets.properties.index",
  });
  const sheetList = meta.data.sheets ?? [];
  const first = [...sheetList].sort(
    (a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0)
  )[0];
  const sheetId = first?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error("The connected Google Sheet has no tabs at all.");
  }
  return sheetId;
}

/**
 * Deletes specific 1-indexed rows (e.g. all rows belonging to a deleted
 * campaign). Rows must be removed highest-index-first within a single
 * batchUpdate call — deleting a lower row shifts everything below it up,
 * which would invalidate the remaining row numbers if done out of order.
 */
export async function deleteLeadRows(
  serviceAccountJson: string,
  spreadsheetId: string,
  rowNumbers: number[]
): Promise<void> {
  if (rowNumbers.length === 0) return;
  const sheets = getClient(serviceAccountJson);
  const sheetId = await getPrimarySheetId(sheets, spreadsheetId);

  const sortedDescending = [...new Set(rowNumbers)].sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: sortedDescending.map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      })),
    },
  });
}

export interface NoWebsiteSheetRow {
  date: string; // YYYY-MM-DD
  businessName: string;
  phone: string;
  address: string;
  category: string;
  googleMapsUrl: string;
}

function noWebsiteRowToValues(row: NoWebsiteSheetRow): string[] {
  return [row.date, row.businessName, row.phone, row.address, row.category, row.googleMapsUrl];
}

/**
 * Finds the dedicated "No Website Leads" tab by name, creating it (with its
 * header row) the first time it's needed — unlike the main leads sheet,
 * which always writes into whatever the user's own first tab is, this is a
 * tab our own code owns, so it's fine to provision automatically.
 */
async function ensureNoWebsiteSheetTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === NO_WEBSITE_SHEET_TAB_NAME
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: NO_WEBSITE_SHEET_TAB_NAME } } }],
      },
    });
  }

  const quoted = quoteSheetName(NO_WEBSITE_SHEET_TAB_NAME);
  const lastCol = columnLetter(NO_WEBSITE_SHEET_HEADERS.length - 1);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoted}!A1:${lastCol}1`,
  });
  const firstRow = res.data.values?.[0] ?? [];
  const matches =
    firstRow.length === NO_WEBSITE_SHEET_HEADERS.length &&
    firstRow.every((cell, i) => cell === NO_WEBSITE_SHEET_HEADERS[i]);
  if (!matches) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoted}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [NO_WEBSITE_SHEET_HEADERS] },
    });
  }
}

/** Appends no-website leads to their dedicated sheet tab — append-only, no per-row updates needed since these never get enriched/sent to. */
export async function appendNoWebsiteLeadRows(
  serviceAccountJson: string,
  spreadsheetId: string,
  rows: NoWebsiteSheetRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getClient(serviceAccountJson);
  await ensureNoWebsiteSheetTab(sheets, spreadsheetId);

  const quoted = quoteSheetName(NO_WEBSITE_SHEET_TAB_NAME);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoted}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows.map(noWebsiteRowToValues) },
  });
}

export function getServiceAccountEmail(serviceAccountJson: string): string | null {
  try {
    const parsed = JSON.parse(serviceAccountJson);
    return typeof parsed.client_email === "string" ? parsed.client_email : null;
  } catch {
    return null;
  }
}
