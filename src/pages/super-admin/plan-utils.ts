export type PlanValue = { plan: "demo" | "paid"; months: string; amount: string };
export const emptyPlan: PlanValue = { plan: "demo", months: "1", amount: "" };

/** Arguments for api.tenants.create / api.subscriptions.set. Throws a readable message when a paid plan is incomplete. */
export function planArgs(v: PlanValue) {
  if (v.plan === "demo") return { plan: "demo" as const };
  const months = Number(v.months), amount = Number(v.amount);
  if (!Number.isInteger(months) || months < 1) throw new Error("Weka idadi ya miezi (1 hadi 60).");
  if (!(amount > 0)) throw new Error("Weka kiasi kilicholipwa.");
  return { plan: "paid" as const, months, amount };
}

export type Sub = { plan: "demo" | "paid" | "none"; endsAt?: string; daysLeft?: number; expired: boolean; expiringSoon: boolean };
