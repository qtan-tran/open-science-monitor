// ISO week helpers. Weeks run Monday..Sunday; ids look like "2026-W47".

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function weekMondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun ... 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  return new Date(d.getTime() + diff * DAY_MS);
}

/** ISO week id like "2026-W47" for the week containing `date`. */
export function isoWeekIdOf(date: Date): string {
  const monday = weekMondayOf(date);
  // Thursday of this ISO week decides the year.
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  // Number of full weeks between the week of Jan 1 and this week.
  const week = Math.round((monday.getTime() - weekMondayOf(jan1).getTime()) / (7 * DAY_MS)) + 1;
  return `${String(year).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC for an ISO week id like "2026-W47". Throws on bad ids. */
export function mondayOfIsoWeek(weekId: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) throw new Error(`Invalid ISO week id: ${weekId}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) throw new Error(`Invalid ISO week number: ${weekId}`);
  const jan1 = weekMondayOf(new Date(Date.UTC(year, 0, 1)));
  const monday = new Date(jan1.getTime() + (week - 1) * 7 * DAY_MS);
  if (isoWeekIdOf(monday) !== weekId) throw new Error(`ISO week ${weekId} does not exist`);
  return monday;
}

/** Friday of the ISO week, at 08:30 Europe/Berlin, as a UTC instant. */
export function fridayBerlin830(weekId: string): Date {
  const monday = mondayOfIsoWeek(weekId);
  const friday = new Date(monday.getTime() + 4 * DAY_MS); // Friday 00:00 UTC
  return atBerlinTime(friday, 8, 30);
}

/**
 * Convert a wall-clock time in Europe/Berlin (CET/CEST) on the UTC date of
 * `day` into a UTC instant. Uses Intl to resolve the actual offset,
 * including DST transitions.
 */
export function atBerlinTime(day: Date, hours: number, minutes: number): Date {
  const y = day.getUTCFullYear();
  const mo = day.getUTCMonth();
  const d = day.getUTCDate();
  // First guess: treat the wall time as UTC.
  let guess = new Date(Date.UTC(y, mo, d, hours, minutes, 0));
  for (let i = 0; i < 3; i++) {
    const offset = berlinOffsetMs(guess);
    const next = new Date(Date.UTC(y, mo, d, hours, minutes, 0) - offset);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess;
}

/** Offset of Europe/Berlin over the given UTC instant, in ms (CET: +3600000). */
export function berlinOffsetMs(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUTC - instant.getTime();
}

/** Berlin wall-clock parts of an instant, e.g. {2026-11-20, 08:30}. */
export function berlinWallClock(instant: Date): {
  date: string;
  hours: number;
  minutes: number;
} {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hours: Number(get("hour")) % 24,
    minutes: Number(get("minute")),
  };
}

/**
 * Cron guard: true when the given instant is "the" 08:30 Europe/Berlin slot
 * for its ISO week's Friday (used to select between the two scheduled crons,
 * one for CET and one for CEST, without double-firing).
 */
export function isFridayBerlinRunSlot(instant: Date, toleranceMinutes = 20): boolean {
  const weekId = isoWeekIdOf(instant);
  const slot = fridayBerlin830(weekId);
  return Math.abs(slot.getTime() - instant.getTime()) <= toleranceMinutes * 60 * 1000;
}
