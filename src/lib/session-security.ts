/**
 * Session security for shared tablets / shop computers.
 *
 * Convex Auth keeps the login token in localStorage by default, so closing the browser or locking the tablet kept the person signed in
 * (the next person who opened the app landed in the previous user's account without a password). Here the token lives in sessionStorage:
 * it disappears when the tab / browser is closed. A last-activity clock (kept even while the device sleeps) signs the user out after
 * the idle limit, and any token an older version left in localStorage is removed.
 */
const TOKEN_PREFIX = "__convexAuth";
const ACTIVITY_KEY = "smarthub.lastActivity";

/** Token storage handed to ConvexAuthProvider: per-tab, wiped when the tab / browser closes. */
export const sessionTokenStorage = {
  getItem: (key: string) => { try { return window.sessionStorage.getItem(key); } catch { return null; } },
  setItem: (key: string, value: string) => { try { window.sessionStorage.setItem(key, value); } catch { /* storage unavailable: user simply signs in again */ } },
  removeItem: (key: string) => { try { window.sessionStorage.removeItem(key); } catch { /* ignore */ } },
};

/** Removes login tokens that earlier versions saved permanently on this device. */
export function purgeLegacyTokens() {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(TOKEN_PREFIX)) stale.push(key);
    }
    stale.forEach((key) => window.localStorage.removeItem(key));
  } catch { /* ignore */ }
}

export const markActivity = () => { try { window.sessionStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ } };
export const clearActivity = () => { try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* ignore */ } };
export function lastActivity(): number | null {
  try {
    const raw = window.sessionStorage.getItem(ACTIVITY_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** True when the last recorded activity is older than `minutes`. A missing clock counts as expired. */
export function isIdleExpired(minutes: number, now = Date.now()): boolean {
  const last = lastActivity();
  return last === null || now - last > minutes * 60_000;
}

/** Idle limit in minutes. The Super Admin account can never be left open longer than 10 minutes, and 0 ("disabled") is not honoured for it. */
export function idleLimitMinutes(configured: number, isSuperAdmin: boolean): number {
  const base = Number.isFinite(configured) && configured > 0 ? configured : (isSuperAdmin ? 10 : 0);
  if (isSuperAdmin) return Math.min(base || 10, 10);
  return base;
}

/** The browser can hide typed characters without being a "password" field, so Chrome does not offer saved passwords or "Save password?". */
export const supportsTextMask = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("-webkit-text-security", "disc");
