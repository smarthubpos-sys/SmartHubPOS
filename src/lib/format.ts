import { getLocale } from "./i18n.ts";

/** Local calendar date (YYYY-MM-DD) in the user's timezone, not UTC. */
/** Business date in East Africa Time (Africa/Dar_es_Salaam, UTC+3, no DST) — same rule as the server's `tzToday()`, whatever the device's own timezone is. */
export const EAT_OFFSET_MS = 3 * 3600000;
export function localDate(offsetDays = 0, now = Date.now()) {
  return new Date(now + EAT_OFFSET_MS + offsetDays * 86400000).toISOString().slice(0, 10);
}
export const tzOffset = () => new Date().getTimezoneOffset();

export function formatNumber(n: number, decimals = 0) {
  return (Number.isFinite(n) ? n : 0).toLocaleString(getLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
/** 1 250 000 -> 1.25M (for chart axes and small tiles). */
export function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
export function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(getLocale(), { day: "2-digit", month: "short", year: "numeric" });
}
