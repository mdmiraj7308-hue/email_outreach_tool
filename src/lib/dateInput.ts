// datetime-local inputs need "YYYY-MM-DDTHH:mm" in LOCAL time — Date's own
// toISOString() is UTC, so format manually to avoid shifting the displayed
// time on load.
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
