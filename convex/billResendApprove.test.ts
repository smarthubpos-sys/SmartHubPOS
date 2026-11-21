import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;
const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const user = (username: string, role: string, extra: object = {}) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const waiter = await user("juma", "waiter", { staffCode: "W01" });
    const waiter2 = await user("neema", "waiter", { staffCode: "W02" });
    const cashier = await user("cash", "cashier");
    const manager = await user("mgr", "manager");
    const group = await ctx.db.insert("productGroups", { tenantId, code: "DR", name: "Vinywaji", isActive: true });
    const bia = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", groupId: group, sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    const order = (waiterId: Id<"users">, name: string, printedAt: string | undefined) => ctx.db.insert("waiterOrders", {
      tenantId, customerName: "", tableNumber: "3", waiterId, waiterName: name, status: "pending", billSentAt: now, billPrintedAt: printedAt,
      lines: [{ productId: bia, productName: "Bia", qty: 1, unitPrice: 2000, lineTotal: 2000 }], total: 2000, createdAt: now, updatedAt: now,
    });
    const printedToday = await order(waiter, "juma", now);
    const printedYesterday = await order(waiter, "juma", new Date(Date.now() - 36 * 3600000).toISOString());
    return { tenantId, boss, waiter, waiter2, cashier, manager, printedToday, printedYesterday };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  return { t, ...ids, asWaiter: as(ids.waiter, 2), asWaiter2: as(ids.waiter2, 3), asCashier: as(ids.cashier, 4), asManager: as(ids.manager, 5) };
}

describe("waiter re-sends a printed bill to the cashier", () => {
  it("the printed bill is only in the waiter's card; resend puts it back on the cashier's list; reprint is recorded", async () => {
    const { t, asWaiter, asCashier, printedToday } = await setup();
    // printed bills are not in anyone's open list
    expect((await asCashier.query(api.waiterOrders.listForBills, {})).map((o) => o._id)).not.toContain(printedToday);
    expect((await asWaiter.query(api.waiterOrders.listForBills, {})).map((o) => o._id)).not.toContain(printedToday);
    // the waiter's card holds today's printed bills only (the one from yesterday is not there)
    const card = await asWaiter.query(api.waiterOrders.printedBillsToday, {});
    expect(card.map((b) => b._id)).toEqual([printedToday]);
    expect(card[0].resendPending).toBe(false);

    await asWaiter.mutation(api.waiterOrders.resendBill, { orderIds: [printedToday] });
    await asWaiter.mutation(api.waiterOrders.resendBill, { orderIds: [printedToday] }); // twice is harmless
    expect((await asWaiter.query(api.waiterOrders.printedBillsToday, {}))[0].resendPending).toBe(true);
    const cashierList = await asCashier.query(api.waiterOrders.listForBills, {});
    expect(cashierList.map((o) => o._id)).toContain(printedToday);
    expect((await asWaiter.query(api.waiterOrders.listForBills, {})).map((o) => o._id)).not.toContain(printedToday); // not back in the waiter's open list

    const before = await t.run((ctx) => ctx.db.get("waiterOrders", printedToday));
    await asCashier.mutation(api.waiterOrders.markBillPrinted, { orderIds: [printedToday] });
    const after = await t.run((ctx) => ctx.db.get("waiterOrders", printedToday));
    expect(after?.billPrintedAt).toBe(before?.billPrintedAt); // the first print time is kept
    expect(after?.billReprintedAt).toBeTruthy();
    expect((await asCashier.query(api.waiterOrders.listForBills, {})).map((o) => o._id)).not.toContain(printedToday); // gone again after the cashier printed
    expect((await asWaiter.query(api.waiterOrders.printedBillsToday, {}))[0].resendPending).toBe(false);
    // money / stock / sales untouched
    expect(after?.total).toBe(2000);
  });

  it("only the waiter's own bill, only today's, only a printed one", async () => {
    const { asWaiter, asWaiter2, asCashier, printedToday, printedYesterday } = await setup();
    await expect(asWaiter2.mutation(api.waiterOrders.resendBill, { orderIds: [printedToday] })).rejects.toThrow();
    await expect(asCashier.mutation(api.waiterOrders.resendBill, { orderIds: [printedToday] })).rejects.toThrow();
    await expect(asWaiter.mutation(api.waiterOrders.resendBill, { orderIds: [printedYesterday] })).rejects.toThrow();
    expect(await asWaiter2.query(api.waiterOrders.printedBillsToday, {})).toEqual([]);
  });
});

describe("expense approval (Idhinisha instead of Lipa)", () => {
  const bill = { vendor: "TANESCO", category: "electricity", billDate: day, dueDate: day, amount: 1000 };

  it("a manager approves; the bill stays in the list, unpaid, and nothing is paid or posted twice", async () => {
    const { t, asManager } = await setup();
    const id = await asManager.mutation(api.bills.create, bill);
    const entriesBefore = (await t.run((ctx) => ctx.db.query("journalEntries").collect())).length;
    expect((await asManager.query(api.bills.rights, {})).canApprove).toBe(true);
    await asManager.mutation(api.bills.approve, { billId: id });
    await asManager.mutation(api.bills.approve, { billId: id }); // twice is harmless
    const row = (await asManager.query(api.bills.list)).find((b) => b._id === id);
    expect(row?.approvedAt).toBeTruthy();
    expect(row?.status).toBe("unpaid"); // still listed as open, nothing was paid
    expect(row?.paidAmount).toBe(0);
    expect((await t.run((ctx) => ctx.db.query("journalEntries").collect())).length).toBe(entriesBefore);
  });

  it("someone without the right cannot approve; with accounts.approve they can; a changed amount removes the approval", async () => {
    const { t, asManager, asCashier, cashier } = await setup();
    const id = await asManager.mutation(api.bills.create, bill);
    expect((await asCashier.query(api.bills.rights, {})).canApprove).toBe(false);
    await expect(asCashier.mutation(api.bills.approve, { billId: id })).rejects.toThrow();
    await t.run((ctx) => ctx.db.patch("users", cashier, { extraPermissions: ["accounts.approve"] }));
    await asCashier.mutation(api.bills.approve, { billId: id });
    expect((await asManager.query(api.bills.list)).find((b) => b._id === id)?.approvedAt).toBeTruthy();
    await asManager.mutation(api.bills.update, { billId: id, ...bill, amount: 1500 });
    expect((await asManager.query(api.bills.list)).find((b) => b._id === id)?.approvedAt).toBeUndefined();
  });

  it("a voided bill cannot be approved", async () => {
    const { asManager } = await setup();
    const id = await asManager.mutation(api.bills.create, bill);
    await asManager.mutation(api.bills.voidBill, { billId: id });
    await expect(asManager.mutation(api.bills.approve, { billId: id })).rejects.toThrow();
  });
});
