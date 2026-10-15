// Display formatting for dates (always Australia/Sydney). Money formatting lives in lib/money.ts.
import { calendarDaysBetween, now } from "./clock";

const TZ = "Australia/Sydney";
const dayMonth = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short" });
const time = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

// en-AU writes "Sept"; the product copy uses three-letter months.
const sep = (s: string) => s.replace("Sept", "Sep");
/** "12 Sep" */
export const formatDay = (d: Date) => sep(dayMonth.format(d));
/** "12 Sep 2026" */
export const formatDate = (d: Date) => sep(dayMonthYear.format(d));
/** "Mon 13 Oct" */
export const formatWeekdayDay = (d: Date) => `${weekday.format(d)} ${formatDay(d)}`;
/** "2:15 PM" */
export const formatTime = (d: Date) => time.format(d).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`);
/** "8 Oct, 2:15 PM" */
export const formatDateTime = (d: Date) => `${formatDay(d)}, ${formatTime(d)}`;

/** "Today, 6:05 AM" · "Yesterday, 5:12 PM" · "8 Oct" */
export function formatRelative(d: Date, asOf: Date = now()): string {
  const diff = calendarDaysBetween(d, asOf);
  if (diff === 0) return `Today, ${formatTime(d)}`;
  if (diff === 1) return `Yesterday, ${formatTime(d)}`;
  return formatDay(d);
}

/** "9 days" / "1 day" */
export const formatDays = (n: number) => `${n} ${Math.abs(n) === 1 ? "day" : "days"}`;

/** YYYY-MM-DD in Sydney, for <input type="date"> */
export const toDateInput = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
