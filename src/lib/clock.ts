// Demo clock. The story is "Sarah's Monday": Mon 13 Oct 2026, Sydney.
// In DEMO_MODE, "today" is pinned to that date so overdue days match the script on any day;
// the time of day is the real Sydney wall-clock time, so new audit events read naturally.

export const DEMO_DATE = "2026-10-13";
const TZ = "Australia/Sydney";

/** Sydney UTC offset on a given date: AEDT (+11) from the first Sunday of October to the first Sunday of April. */
function sydneyOffset(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const firstSunday = (month: number) => {
    const dow = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - dow) % 7);
  };
  const dst = m > 10 || m < 4 || (m === 10 && d >= firstSunday(10)) || (m === 4 && d < firstSunday(4));
  return dst ? "+11:00" : "+10:00";
}

/** Build a Date from a Sydney local date/time, e.g. sydney("2026-10-12", "17:12"). */
export function sydney(date: string, time = "00:00"): Date {
  return new Date(`${date}T${time}:00${sydneyOffset(date)}`);
}

/** A date-only value (issue/due dates). Stored at Sydney noon so it never slips a day when formatted. */
export function dateOnly(date: string): Date {
  return sydney(date, "12:00");
}

/** Sydney calendar date (YYYY-MM-DD) of an instant. */
export function sydneyYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? "true") !== "false";
}

/** Current instant. In demo mode: DEMO_DATE + real Sydney time of day. */
export function now(): Date {
  const real = new Date();
  if (!isDemoMode()) return real;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(real);
  return sydney(DEMO_DATE, time);
}

/** The current demo/real day as a date-only value. */
export function today(): Date {
  return dateOnly(sydneyYmd(now()));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days between two instants' Sydney dates (b − a). */
export function calendarDaysBetween(a: Date, b: Date): number {
  const toUtc = (d: Date) => {
    const [y, m, day] = sydneyYmd(d).split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Whole days from dueDate to today (negative = not due yet). */
export function daysOverdue(dueDate: Date, asOf: Date = today()): number {
  return calendarDaysBetween(dueDate, asOf);
}
