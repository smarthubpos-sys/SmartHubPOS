/** Words typed in a "search item" box: every word must appear in the item name or code (any order, any case). Empty search = everything. */
export function productMatches(p: { name?: string; itemCode?: string } | undefined, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${p?.name ?? ""} ${p?.itemCode ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
