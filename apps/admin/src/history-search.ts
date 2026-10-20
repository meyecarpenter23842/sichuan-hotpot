export type HistoryPeriod = "all" | "today" | "yesterday" | "week" | "month" | "thisMonth" | "custom";
export type HistoryRange = { period: HistoryPeriod; from: string | null; to: string | null };
export const ALL_HISTORY: HistoryRange = { period: "all", from: null, to: null };
const DAY_MS = 86400000;
const VN_OFFSET = 7 * 3600000;

export function vietnamDay(now: Date = new Date()): string {
  return new Date(now.getTime() + VN_OFFSET).toISOString().slice(0, 10);
}
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + delta * DAY_MS)
    .toISOString().slice(0, 10);
}
export function historyPeriodRange(period: Exclude<HistoryPeriod, "custom">,
  now: Date = new Date()): HistoryRange {
  if (period === "all") return ALL_HISTORY;
  const to = vietnamDay(now);
  if (period === "yesterday") {
    const day = shiftDay(to, -1);
    return { period, from: day, to: day };
  }
  if (period === "thisMonth") return { period, from: to.slice(0, 7) + "-01", to };
  const span = period === "today" ? 0 : period === "week" ? 6 : 29;
  return { period, from: shiftDay(to, -span), to };
}
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") -
    Date.parse(from + "T00:00:00Z")) / DAY_MS) + 1;
}
export function showDay(day: string): string {
  const [y, m, d] = day.split("-");
  return d + "/" + m + "/" + y;
}
/** Fixed six-week calendar; Monday is the first weekday, not Sunday. */
export function calendarGrid(year: number, monthZeroBased: number): (string | null)[] {
  const first = new Date(Date.UTC(year, monthZeroBased, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    return day >= 1 && day <= days
      ? String(year).padStart(4, "0") + "-" +
        String(monthZeroBased + 1).padStart(2, "0") + "-" +
        String(day).padStart(2, "0") : null;
  });
}
export function validHistoryCode(code: string): boolean {
  const trimmed = code.trim().replace(/^#/, "");
  return /^[0-9a-f]{8}$/i.test(trimmed) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}
