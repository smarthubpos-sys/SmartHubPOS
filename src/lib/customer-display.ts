/**
 * Customer display: a second screen facing the customer. The Selling Point publishes the current order here (quantities and total)
 * and the display page (/customer-display, opened in another window on the same computer) shows it, growing as items are added.
 */
export type DisplayLine = { name: string; qty: number; price: number; total: number };
export type DisplayState = { businessName: string; lines: DisplayLine[]; itemCount: number; total: number; updatedAt: number; numbersOnly?: boolean };

const CHANNEL = "smarthub-customer-display";
const KEY = "smarthub-customer-display-state";

export const emptyDisplay = (businessName = ""): DisplayState => ({ businessName, lines: [], itemCount: 0, total: 0, updatedAt: Date.now() });

/** Builds what the customer sees from the cart lines (quantity may be a fraction such as 0.5). */
export function buildDisplayState(businessName: string, lines: Array<{ name: string; qty: number; price: number }>, numbersOnly = false): DisplayState {
  const rows = lines.filter((l) => l.qty > 0).map((l) => ({ name: l.name, qty: l.qty, price: l.price, total: Math.round(l.qty * l.price * 100) / 100 }));
  return {
    businessName,
    lines: rows,
    itemCount: Math.round(rows.reduce((s, r) => s + r.qty, 0) * 1000) / 1000,
    total: Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100,
    updatedAt: Date.now(),
    numbersOnly,
  };
}

export function publishDisplay(state: DisplayState) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  try { if (typeof BroadcastChannel !== "undefined") { const ch = new BroadcastChannel(CHANNEL); ch.postMessage(state); ch.close(); } } catch { /* not supported */ }
}

export function readDisplay(): DisplayState | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as DisplayState) : null; } catch { return null; }
}

export function subscribeDisplay(onState: (s: DisplayState) => void): () => void {
  let ch: BroadcastChannel | null = null;
  try { if (typeof BroadcastChannel !== "undefined") { ch = new BroadcastChannel(CHANNEL); ch.onmessage = (e) => onState(e.data as DisplayState); } } catch { /* not supported */ }
  const onStorage = (e: StorageEvent) => { if (e.key === KEY && e.newValue) { try { onState(JSON.parse(e.newValue) as DisplayState); } catch { /* ignore */ } } };
  window.addEventListener("storage", onStorage);
  return () => { ch?.close(); window.removeEventListener("storage", onStorage); };
}

export const openCustomerDisplay = () => { window.open("/customer-display", "smarthub-customer-display", "popup=yes,width=1024,height=768"); };

export const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000);
