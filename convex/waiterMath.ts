import type { Doc } from "./_generated/dataModel";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Part of a bill that the cashier moved to a registered customer (his debt now, not the waiter's). */
export const assignedOf = (o: Pick<Doc<"waiterOrders">, "assignedAmount">) => o.assignedAmount ?? 0;

/** What the WAITER still owes for a bill: total - money received - the part moved to a customer. */
export const waiterOwes = (o: Pick<Doc<"waiterOrders">, "total" | "paidAmount" | "assignedAmount">) => Math.max(0, r2(o.total - (o.paidAmount ?? 0) - assignedOf(o)));
