import type { Id } from "./_generated/dataModel";

/**
 * Business subscription helpers.
 * Dates are plain "YYYY-MM-DD" strings in East Africa time (UTC+3).
 * `planEndsAt` is the LAST day the business can use the system; it is expired from the next day.
 * Businesses created before subscriptions existed have no `planEndsAt` and never expire.
 */
export const DEMO_DAYS = 3;
export const WARN_DAYS = 7;

const DAY = 86400000;
const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const tzToday = () => fmt(Date.now() + 3 * 3600000);
export const addDays = (d: string, n: number) => fmt(toUtc(d) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY);
export function addMonths(d: string, n: number) {
  const total = Number(d.slice(5, 7)) - 1 + n;
  const year = Number(d.slice(0, 4)) + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fmt(Date.UTC(year, month, Math.min(Number(d.slice(8, 10)), last)));
}
export const planEnd = (start: string, plan: "demo" | "paid", months = 0) => (plan === "demo" ? addDays(start, DEMO_DAYS - 1) : addDays(addMonths(start, months), -1));

export type PlanStatus = { plan: "demo" | "paid" | "none"; endsAt?: string; daysLeft?: number; expired: boolean; expiringSoon: boolean };
export function planStatus(tenant: { plan?: string; planEndsAt?: string } | null | undefined, today: string): PlanStatus {
  if (!tenant?.planEndsAt) return { plan: "none", expired: false, expiringSoon: false };
  const daysLeft = daysBetween(today, tenant.planEndsAt);
  return { plan: tenant.plan === "paid" ? "paid" : "demo", endsAt: tenant.planEndsAt, daysLeft, expired: daysLeft < 0, expiringSoon: daysLeft >= 0 && daysLeft <= WARN_DAYS };
}

/** Sets a business to a 3-day demo, or records a payment (extends from the current end when still running). */
export async function applyPlan(ctx: any, tenantId: Id<"tenants">, opts: { plan: "demo" | "paid"; months?: number; amount?: number; note?: string }, createdBy?: Id<"users">) {
  const tenant = await ctx.db.get(tenantId);
  if (!tenant) throw new Error("Biashara haipo");
  const today = tzToday();
  if (opts.plan === "demo") {
    await ctx.db.patch(tenantId, { plan: "demo", planStartsAt: today, planEndsAt: planEnd(today, "demo"), planMonths: undefined, planAmount: undefined });
    return { plan: "demo" as const, startsAt: today, endsAt: planEnd(today, "demo") };
  }
  const { months, amount } = opts;
  if (months === undefined || !Number.isInteger(months) || months < 1 || months > 60) throw new Error("Weka idadi ya miezi (1 hadi 60).");
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) throw new Error("Weka kiasi kilicholipwa.");
  const status = planStatus(tenant, today);
  const extending = tenant.plan === "paid" && !!status.endsAt && !status.expired;
  const startsAt = extending ? addDays(status.endsAt!, 1) : today;
  const endsAt = planEnd(startsAt, "paid", months);
  await ctx.db.insert("subscriptionPayments", { tenantId, amount, months, startsAt, endsAt, note: opts.note?.trim() || undefined, createdBy, createdAt: new Date().toISOString() });
  await ctx.db.patch(tenantId, { plan: "paid", planStartsAt: extending ? (tenant.planStartsAt ?? startsAt) : startsAt, planEndsAt: endsAt, planMonths: months, planAmount: amount });
  return { plan: "paid" as const, startsAt, endsAt };
}
