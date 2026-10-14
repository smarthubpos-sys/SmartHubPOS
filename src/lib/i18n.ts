/**
 * Single-language i18n.
 *
 * The whole system uses ONE language at a time: the language saved in
 * Maintenance > Language Settings for the business (sw | en). It is cached in
 * localStorage so the login page and the business picker (no business selected
 * yet) use the same language, and changing it reloads the app so every screen
 * (including module-level constants) is rendered in that single language.
 *
 * Source strings in the code are the lookup keys. Dynamic parts use {0}, {1}...
 */
import { DICT as UI_DICT } from "./i18n-dict.ts";
import { SERVER_DICT } from "./i18n-server-dict.ts";
import { EXTRA_DICT } from "./i18n-dict-subscriptions.ts";
import { ACCESS_DICT } from "./i18n-dict-access.ts";
import { SUPERADMIN_DICT, INVOICING_DICT, DEPT_DICT } from "./i18n-dict-superadmin.ts";
import { PREPORT_DICT } from "./i18n-dict-preports.ts";
import { PAYMENTS_DICT } from "./i18n-dict-payments.ts";
import { PERIOD_REPORT_DICT } from "./i18n-dict-periodreport.ts";

const DICT: Record<string, { sw: string; en: string }> = { ...SERVER_DICT, ...UI_DICT, ...EXTRA_DICT, ...ACCESS_DICT, ...SUPERADMIN_DICT, ...INVOICING_DICT, ...DEPT_DICT, ...PREPORT_DICT, ...PAYMENTS_DICT, ...PERIOD_REPORT_DICT };

export type Lang = "sw" | "en";
const STORAGE_KEY = "smarthub.lang";

function readStored(): Lang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "en" || v === "sw" ? v : "sw";
  } catch {
    return "sw";
  }
}

let current: Lang = typeof window === "undefined" ? "sw" : readStored();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const getLang = (): Lang => current;
export const getLocale = () => (current === "sw" ? "sw-TZ" : "en-US");

/** Saves the system language. Reloads the page when it changed so all screens switch together. */
export function setLang(next: Lang, options: { reload?: boolean } = {}): boolean {
  if (next !== "sw" && next !== "en") return false;
  if (next === current) return false;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (options.reload !== false && typeof window !== "undefined") window.location.reload();
  return true;
}

type Vars = ReadonlyArray<string | number | null | undefined>;

/** Translate a source string into the system language. Unknown strings are returned unchanged. */
export function tr(text: string, vars?: Vars): string {
  const entry = DICT[text];
  let out = entry ? entry[current] ?? text : text;
  if (vars) out = out.replace(/\{(\d+)\}/g, (_m, i) => String(vars[Number(i)] ?? ""));
  return out;
}

/* Patterns for dictionary entries that contain {n} placeholders (used for backend error messages). */
let patterns: { re: RegExp; entry: { sw: string; en: string } }[] | null = null;
function getPatterns() {
  if (patterns) return patterns;
  patterns = Object.entries(DICT)
    .filter(([key]) => /\{\d+\}/.test(key))
    .map(([key, entry]) => {
      const escaped = key.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\d+\}/g, "(.+?)");
      return { re: new RegExp(`^${escaped}$`), entry };
    });
  return patterns;
}

/** Translates a backend/runtime message (already a plain string) when it is known. */
export function trMessage(message: string): string {
  const clean = message.trim();
  if (DICT[clean]) return tr(clean);
  for (const { re, entry } of getPatterns()) {
    const m = re.exec(clean);
    if (m) return (entry[current] ?? clean).replace(/\{(\d+)\}/g, (_x, i) => m[Number(i) + 1] ?? "");
  }
  return clean;
}

/** Convex wraps server errors ("[CONVEX M(x)] ... Uncaught Error: <message>\n at handler..."): extract the message. */
export function errorText(e: unknown, fallback?: string): string {
  if (!(e instanceof Error) || !e.message) return fallback ? tr(fallback) : "";
  let msg = e.message;
  const uncaught = msg.indexOf("Uncaught Error:");
  if (uncaught >= 0) msg = msg.slice(uncaught + "Uncaught Error:".length);
  msg = msg.split("\n")[0].replace(/^\s*(Server Error\s*)?/, "").trim();
  if (!msg || /^\[CONVEX/.test(msg) || msg === "Server Error") return fallback ? tr(fallback) : tr("Hitilafu imetokea.");
  return trMessage(msg);
}

/* Labels for stored enum values (status, payment method, movement type...) shown in tables. */
const VALUES: Record<string, { sw: string; en: string }> = {
  draft: { sw: "Rasimu", en: "Draft" },
  pending_approval: { sw: "Inasubiri idhini", en: "Pending approval" },
  approved: { sw: "Imeidhinishwa", en: "Approved" },
  confirmed: { sw: "Imethibitishwa", en: "Confirmed" },
  partially_received: { sw: "Imepokelewa kiasi", en: "Partially received" },
  received: { sw: "Imepokelewa", en: "Received" },
  posted: { sw: "Imepostiwa", en: "Posted" },
  paid: { sw: "Imelipwa", en: "Paid" },
  partial: { sw: "Imelipwa kiasi", en: "Partially paid" },
  unpaid: { sw: "Haijalipwa", en: "Unpaid" },
  cancelled: { sw: "Imeghairiwa", en: "Cancelled" },
  open: { sw: "Wazi", en: "Open" },
  closed: { sw: "Imefungwa", en: "Closed" },
  locked: { sw: "Imefungwa kabisa", en: "Locked" },
  cash: { sw: "Fedha taslimu", en: "Cash" },
  bank: { sw: "Benki", en: "Bank" },
  mobile: { sw: "Pesa za simu", en: "Mobile money" },
  mobile_money: { sw: "Pesa za simu", en: "Mobile money" },
  cheque: { sw: "Hundi", en: "Cheque" },
  opening: { sw: "Mwanzo", en: "Opening" },
  purchase: { sw: "Ununuzi", en: "Purchase" },
  purchase_return: { sw: "Marejesho ya manunuzi", en: "Purchase return" },
  sale: { sw: "Mauzo", en: "Sale" },
  sales_return: { sw: "Marejesho ya mauzo", en: "Sales return" },
  grn: { sw: "Upokeaji (GRN)", en: "Goods received (GRN)" },
  adjustment: { sw: "Marekebisho", en: "Adjustment" },
  allow: { sw: "Ruhusu", en: "Allow" },
  warn: { sw: "Onya", en: "Warn" },
  require_approval: { sw: "Inahitaji idhini", en: "Require approval" },
  block: { sw: "Zuia", en: "Block" },
  monthly: { sw: "Kila mwezi", en: "Monthly" },
  daily: { sw: "Kila siku", en: "Daily" },
  hourly: { sw: "Kila saa", en: "Hourly" },
  asset: { sw: "Mali", en: "Asset" },
  liability: { sw: "Deni", en: "Liability" },
  equity: { sw: "Mtaji", en: "Equity" },
  revenue: { sw: "Mapato", en: "Revenue" },
  expense: { sw: "Matumizi", en: "Expense" },
  active: { sw: "Inatumika", en: "Active" },
  inactive: { sw: "Haitumiki", en: "Inactive" },
  success: { sw: "Imefanikiwa", en: "Success" },
  failed: { sw: "Imeshindikana", en: "Failed" },
  system: { sw: "Mfumo", en: "System" },
};

/** Translate a stored enum value (e.g. "posted", "cash") or a known source string. Unknown values are returned as-is. */
export function trValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value);
  const hit = VALUES[raw.trim().toLowerCase()];
  if (hit) return hit[current];
  return tr(raw);
}
