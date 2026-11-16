export type PlanValue = { plan: "demo" | "paid"; months: string; amount: string; paidOn?: string };
export const emptyPlan: PlanValue = { plan: "demo", months: "1", amount: "" };

/** Arguments for api.tenants.create / api.subscriptions.set. Throws a readable message when a paid plan is incomplete. */
export function planArgs(v: PlanValue) {
  if (v.plan === "demo") return { plan: "demo" as const };
  const months = Number(v.months), amount = Number(v.amount);
  if (!Number.isInteger(months) || months < 1) throw new Error("Weka idadi ya miezi (1 hadi 60).");
  if (!(amount > 0)) throw new Error("Weka kiasi kilicholipwa.");
  return { plan: "paid" as const, months, amount, ...(v.paidOn ? { paidOn: v.paidOn } : {}) };
}

const DAY_MS = 86400000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(utc(d) + n * DAY_MS);
function addMonths(d: string, n: number) {
  const total = Number(d.slice(5, 7)) - 1 + n, year = Number(d.slice(0, 4)) + Math.floor(total / 12), month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(Date.UTC(year, month, Math.min(Number(d.slice(8, 10)), last)));
}

/** What a paid plan will cover, shown BEFORE saving (the server computes the same): starts on the payment day (or after the running plan), ends the day before the same date n months later. */
export function previewPlan(v: PlanValue, today: string, runningUntil?: string): { startsAt: string; endsAt: string } | null {
  const months = Number(v.months);
  if (v.plan !== "paid" || !Number.isInteger(months) || months < 1 || months > 60) return null;
  const startsAt = runningUntil && runningUntil >= today ? addDays(runningUntil, 1) : (v.paidOn || today);
  return { startsAt, endsAt: addDays(addMonths(startsAt, months), -1) };
}

export type Sub = { plan: "demo" | "paid" | "none"; endsAt?: string; daysLeft?: number; expired: boolean; expiringSoon: boolean };
