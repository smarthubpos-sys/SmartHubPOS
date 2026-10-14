export type Row = Record<string, string | number>;

export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => `${today().slice(0, 8)}01`;
export const fmt = (n: number, digits = 2) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
export const num = (v: string | number | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Group items by one or more keys and fold them into report rows. */
export function groupRows<T, R extends Row>(items: T[], key: (item: T) => string, init: (item: T) => R, add: (acc: R, item: T) => void): R[] {
  const map = new Map<string, R>();
  for (const item of items) {
    const k = key(item);
    let acc = map.get(k);
    if (!acc) { acc = init(item); map.set(k, acc); }
    add(acc, item);
  }
  return [...map.values()];
}
