const EAT_OFFSET_MS = 3 * 3600000; // East Africa Time: the business day of the bill, same as the reports

/** "2026-11-13 · 22:30:15": the business DAY and the time a bill / receipt was made, so bills of different days are never confused. */
export function orderStamp(iso: string): string {
  const day = new Date(Date.parse(iso) + EAT_OFFSET_MS).toISOString().slice(0, 10);
  return `${day} · ${new Date(iso).toLocaleTimeString()}`;
}
