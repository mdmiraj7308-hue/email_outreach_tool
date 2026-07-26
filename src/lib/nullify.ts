// Normalizes missing/empty values to the literal string "null" so it can be
// stored and exported (DB + Google Sheet) consistently instead of blanks.
export function nullify(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "null";
}
