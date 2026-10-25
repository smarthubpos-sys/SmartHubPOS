/**
 * Helpers for the ONE sales flow used by every kind of business (hardware shop, pharmacy, hotel, restaurant...).
 *
 * Product groups, floors, tables and rooms are OPTIONAL extras: a business that never defines them sells exactly the
 * same way (pick products -> customer -> save). Nothing here is required to complete a sale.
 */

import { tr } from "./i18n.ts";

export type ServiceKind = "table" | "room";
export type ServicePoint = { kind: ServiceKind; floor: string; name: string };
export const emptyServicePoint = (): ServicePoint => ({ kind: "table", floor: "", name: "" });

export type ServiceWords = { table: string; room: string; floor: string };
const SW_WORDS: ServiceWords = { table: "Meza", room: "Chumba", floor: "Ghorofa" };

/** Kind words in the business language (Maintenance > Language Settings). */
export const serviceWords = (): ServiceWords => ({ table: tr("Meza"), room: tr("Chumba"), floor: tr("Ghorofa") });

/** A stored value that already says what it is ("Chumba 105", "Ghorofa 2 · Meza 5", "Table 3"). */
const KIND_WORD = /^(meza|chumba|ghorofa|table|room|floor)\b/i;

/**
 * The text kept in the order's existing optional `tableNumber` field (or in the invoice notes).
 * A plain table number stays exactly what it always was ("5"), so old orders, bills and reports keep working.
 *   table "5"                 -> "5"
 *   table "5" on floor "2"    -> "Ghorofa 2 · Meza 5"
 *   room "105"                -> "Chumba 105"
 *   room "105" on floor "1"   -> "Ghorofa 1 · Chumba 105"
 *   nothing filled in         -> ""
 */
export function formatServicePoint(p: ServicePoint, words: ServiceWords = SW_WORDS): string {
  const floor = p.floor.trim();
  const name = p.name.trim();
  const parts: string[] = [];
  if (floor) parts.push(`${words.floor} ${floor}`);
  if (name) parts.push(p.kind === "room" ? `${words.room} ${name}` : floor ? `${words.table} ${name}` : name);
  return parts.join(" · ");
}

/** What to show for a stored value: legacy "5" -> "Meza 5"; values that already carry their kind are shown as they are. */
export function servicePointLabel(value: string | null | undefined, tableWord = SW_WORDS.table): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return KIND_WORD.test(v) ? v : `${tableWord} ${v}`;
}

/** True when the stored value already carries its own kind word (so a screen should not prefix "Meza"). */
export const servicePointHasKind = (value: string | null | undefined) => KIND_WORD.test((value ?? "").trim());

type Searchable = { name: string; itemCode?: string | null; barcode?: string | null; groupId?: unknown };

/** Product picker filter. An empty group ("all") and an empty search show every product: both filters are optional. */
export function filterProducts<T extends Searchable>(products: readonly T[], opts: { groupId?: string; query?: string }): T[] {
  const group = opts.groupId && opts.groupId !== "all" ? opts.groupId : "";
  const q = (opts.query ?? "").trim().toLowerCase();
  return products.filter((p) => {
    if (group && String(p.groupId ?? "") !== group) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.itemCode ?? "").toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q);
  });
}

type ClientLike = { _id: unknown; name: string; isActive?: boolean };
const WALK_IN = /(cash|walk[\s-]?in|taslimu|mteja\s+wa\s+kawaida)/i;

/**
 * Walk-in sales (a hardware counter, a kiosk) should not need a customer picked every time: when the business has
 * exactly ONE active "Cash / Walk-in" customer it is pre-selected (the cashier can still change it). Otherwise "".
 */
export function pickWalkInClient(clients: readonly ClientLike[]): string {
  const hits = clients.filter((c) => c.isActive !== false && WALK_IN.test(c.name));
  return hits.length === 1 ? String(hits[0]._id) : "";
}
