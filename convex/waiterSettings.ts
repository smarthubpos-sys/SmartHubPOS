/**
 * Per-business Waiter / Waitress switches.
 *
 * Stored on `tenantSettings`: `waiterEnabled`, `waitressEnabled` (independent), plus `waiterOrderMode`.
 * `waiterOrdersEnabled` is the older single switch. It is kept (and kept in sync = waiter OR waitress) so
 * existing readers keep working, and it is the fallback for businesses saved before the two switches existed:
 * a business that had Waiter Orders ON keeps BOTH roles ON until a Super Admin changes them.
 */
export type WaiterSettingsDoc = {
  waiterOrdersEnabled?: boolean;
  waiterEnabled?: boolean;
  waitressEnabled?: boolean;
  waiterOrderMode?: "cashier" | "print";
} | null | undefined;

export function resolveWaiterSettings(s: WaiterSettingsDoc) {
  const legacy = s?.waiterOrdersEnabled === true;
  const waiterEnabled = s?.waiterEnabled ?? legacy;
  const waitressEnabled = s?.waitressEnabled ?? legacy;
  return {
    waiterEnabled,
    waitressEnabled,
    waiterOrdersEnabled: waiterEnabled || waitressEnabled,
    waiterOrderMode: s?.waiterOrderMode ?? ("cashier" as const),
  };
}

/** Is Waiter Orders switched on for this user's role? waiter/waitress follow their own switch; every other role needs at least one on. */
export function waiterOrdersAllowedFor(role: string | undefined, s: WaiterSettingsDoc) {
  const r = resolveWaiterSettings(s);
  const name = String(role ?? "").toLowerCase();
  if (name === "waiter") return r.waiterEnabled;
  if (name === "waitress") return r.waitressEnabled;
  return r.waiterOrdersEnabled;
}
