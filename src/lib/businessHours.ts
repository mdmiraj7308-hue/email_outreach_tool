const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  weekday: number; // 0=Sun ... 6=Sat
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === "24" ? 0 : Number(map.hour),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

/**
 * Converts a wall-clock date/hour in `timeZone` to the equivalent UTC
 * instant, via iterative offset correction (no timezone-database dependency
 * needed for day/hour-granularity scheduling). Two iterations is enough to
 * converge even across a DST transition.
 */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  let utcGuess = Date.UTC(year, month - 1, day, hour);
  for (let i = 0; i < 2; i++) {
    const parts = getZonedParts(new Date(utcGuess), timeZone);
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour);
    utcGuess -= zonedAsUtc - targetAsUtc;
  }
  return new Date(utcGuess);
}

/**
 * Bumps `from` forward to the next weekday business-hours slot
 * (`startHour`-`endHour`, exclusive of endHour) in `timeZone`. Returns
 * `from` unchanged if it already falls inside the window. Only used for
 * automatically-scheduled sends (sending-campaign confirm, follow-up
 * spacing) — an explicit manual choice (per-lead override, "Send Now") is
 * never bumped, since that's a deliberate human decision.
 */
export function nextBusinessSlot(from: Date, startHour: number, endHour: number, timeZone: string): Date {
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const probe = new Date(from.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const parts = getZonedParts(probe, timeZone);
    if (parts.weekday === 0 || parts.weekday === 6) continue; // weekend

    if (dayOffset === 0) {
      if (parts.hour >= startHour && parts.hour < endHour) return from;
      if (parts.hour < startHour) return zonedTimeToUtc(parts.year, parts.month, parts.day, startHour, timeZone);
      continue; // past today's window — roll to the next loop iteration/day
    }

    return zonedTimeToUtc(parts.year, parts.month, parts.day, startHour, timeZone);
  }
  return from; // 14-day safety bound shouldn't be reachable in practice
}

/**
 * Given an already-resolved business-hours slot, returns the next business
 * day's start-of-window slot. Composable with itself for walking forward
 * day by day (e.g. to find the next day with capacity under a cap) — unlike
 * re-deriving from a raw day-offset added to "now", which can collapse
 * multiple offsets onto the same resolved calendar day whenever a weekend
 * bump is involved (today's Sunday and a naive tomorrow both bump to the
 * same Monday).
 */
export function nextBusinessDayAfter(resolved: Date, startHour: number, endHour: number, timeZone: string): Date {
  const nextDayCandidate = new Date(resolved.getTime() + 24 * 60 * 60 * 1000);
  return nextBusinessSlot(nextDayCandidate, startHour, endHour, timeZone);
}
