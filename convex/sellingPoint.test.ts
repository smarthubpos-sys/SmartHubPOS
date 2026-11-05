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
    const other = await ctx.db.insert("tenants", { name: "Other", code: "OTH", isActive: true, createdByToken: "t", createdAt: now });
    const user = (tid: Id<"tenants">, username: string, role: string, extra: object = {}) => ctx.db.insert("users", { name: username, username, role, tenantId: tid, isActive: true, ...extra });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const waiter = await user(tenantId, "juma", "waiter", { staffCode: "W01" });
    const waiter2 = await user(tenantId, "neema", "waiter", { staffCode: "W02" });
    const editor = await user(tenantId, "editor", "waiter", { staffCode: "W03", extraPermissions: ["sales.view", "sales.edit", "sales.void", "sales.print"] });
    const cashier = await user(tenantId, "cash", "cashier");
    const cashierOther = await user(other, "cash2", "cashier");
    const group = await ctx.db.insert("productGroups", { tenantId, code: "DR", name: "Vinywaji", isActive: true });
    const bia = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", groupId: group, sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    const soda = await ctx.db.insert("products", { tenantId, itemCode: "P2", name: "Soda", groupId: group, sellingPrice: 1000, openingQty: 3, currentQty: 3, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    await ctx.db.insert("invoices", { tenantId, invoiceNo: "INV-1", invoiceDate: day, clientId, subtotal: 6000, discount: 0, taxAmount: 0, total: 6000, amountPaid: 1000, outstanding: 5000, paymentStatus: "partial", status: "posted", createdBy: waiter });
    return { tenantId, other, boss, waiter, waiter2, editor, cashier, cashierOther, bia, soda };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  const asBoss = as(ids.boss, 1);
  await asBoss.mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  const qty = async (id: Id<"products">) => (await t.run(async (ctx) => ctx.db.get("products", id)))?.currentQty;
  const moves = async () => (await t.run(async (ctx) => ctx.db.query("stockMovements").collect())).length;
  return { t, ...ids, asBoss, asWaiter: as(ids.waiter, 2), asWaiter2: as(ids.waiter2, 3), asEditor: as(ids.editor, 6), asCashier: as(ids.cashier, 4), asCashierOther: as(ids.cashierOther, 5), qty, moves };
}

describe("Selling Point: one-time stock deduction", () => {
  it("Send deducts once; repeating the same key returns the same order and deducts nothing more", async () => {
    const { asWaiter, bia, qty, moves, t } = await setup();
    const args = { clientKey: "key-1-abcdefgh", mode: "send" as const, lines: [{ productId: bia, qty: 2 }, { productId: bia, qty: 1 }] };
    const a = await asWaiter.mutation(api.waiterOrders.submit, args);
    const b = await asWaiter.mutation(api.waiterOrders.submit, args);
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true); expect(b.orderId).toBe(a.orderId);
    expect(await qty(bia)).toBe(7);
    expect(await moves()).toBe(1); // the same product tapped on two lines is one movement of 3
    expect(await t.run(async (ctx) => ctx.db.query("waiterOrders").collect())).toHaveLength(1);
    expect(a.status).toBe("pending");
  });

  it("Print deducts once and marks the order printed; table number is optional", async () => {
    const { asWaiter, bia, qty } = await setup();
    const r = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-2-abcdefgh", mode: "print", lines: [{ productId: bia, qty: 1 }] });
    expect(r.status).toBe("printed");
    expect(await qty(bia)).toBe(9);
    const [o] = await asWaiter.query(api.waiterOrders.list, {});
    expect(o.tableNumber).toBeUndefined();
  });

  it("not enough stock: nothing is created and no stock moves (whole mutation rolls back)", async () => {
    const { asWaiter, bia, soda, qty, moves, t } = await setup();
    await expect(asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-3-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 2 }, { productId: soda, qty: 99 }] })).rejects.toThrow(/Stock haitoshi/);
    expect(await qty(bia)).toBe(10); expect(await qty(soda)).toBe(3); expect(await moves()).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.query("waiterOrders").collect())).toHaveLength(0);
  });

  it("cashier receiving a sent order never deducts again, and receiving twice changes nothing", async () => {
    const { asWaiter, asCashier, bia, qty, moves } = await setup();
    const r = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-4-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 4 }] });
    await asCashier.mutation(api.waiterOrders.markHandled, { orderId: r.orderId });
    await asCashier.mutation(api.waiterOrders.markHandled, { orderId: r.orderId });
    expect(await qty(bia)).toBe(6); expect(await moves()).toBe(1);
  });

  it("legacy placed order: Send then Print/Send again deducts only once", async () => {
    const { asWaiter, bia, qty } = await setup();
    const id = await asWaiter.mutation(api.waiterOrders.place, { customerName: "M", lines: [{ productId: bia, qty: 2 }] });
    await asWaiter.mutation(api.waiterOrders.sendToCashier, { orderId: id });
    await asWaiter.mutation(api.waiterOrders.sendToCashier, { orderId: id });
    await expect(asWaiter.mutation(api.waiterOrders.markPrinted, { orderId: id })).rejects.toThrow();
    expect(await qty(bia)).toBe(8);
  });

  it("an unknown or zero quantity is refused", async () => {
    const { asWaiter, bia } = await setup();
    await expect(asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-5-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 0 }] })).rejects.toThrow();
    await expect(asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-6-abcdefgh", mode: "send", lines: [] })).rejects.toThrow();
  });
});

describe("Selling Point: bills", () => {
  it("combined total of several orders is computed on the server; other waiters' orders are refused", async () => {
    const { asWaiter, asWaiter2, asCashier, bia, soda } = await setup();
    const a = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "bill-1-abcdefgh", mode: "send", tableNumber: "5", lines: [{ productId: bia, qty: 2 }] });
    const b = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "bill-2-abcdefgh", mode: "print", tableNumber: "5", lines: [{ productId: bia, qty: 1 }, { productId: soda, qty: 2 }] });
    const c = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "bill-3-abcdefgh", mode: "send", lines: [{ productId: soda, qty: 1 }] });
    const sum = await asWaiter.query(api.waiterOrders.billSummary, { orderIds: [a.orderId, b.orderId] });
    expect(sum.total).toBe(4000 + 2000 + 2000);
    expect(sum.tables).toEqual(["5"]);
    expect(sum.lines.find((l) => l.productName === "Bia")?.qty).toBe(3);
    expect((await asWaiter.query(api.waiterOrders.billSummary, { orderIds: [a.orderId, a.orderId] })).total).toBe(4000); // duplicates are counted once
    expect((await asWaiter.query(api.waiterOrders.listForBills, { table: "5" })).map((o) => o.tableNumber)).toEqual(["5", "5"]);
    expect(await asWaiter.query(api.waiterOrders.listForBills, {})).toHaveLength(3);
    expect(await asWaiter2.query(api.waiterOrders.listForBills, {})).toHaveLength(0);
    await expect(asWaiter2.query(api.waiterOrders.billSummary, { orderIds: [c.orderId] })).rejects.toThrow();
    expect(await asCashier.query(api.waiterOrders.listForBills, {})).toHaveLength(0); // each person keeps his own bills: the waiter's bills do NOT reach the cashier by themselves
    await expect(asCashier.query(api.waiterOrders.billSummary, { orderIds: [a.orderId] })).rejects.toThrow(); // ...and he cannot total them either
  });

  it("a waiter's bill reaches the cashier's Bills screen only after the waiter sends it", async () => {
    const { asWaiter, asWaiter2, asCashier, asCashierOther, bia, soda } = await setup();
    const a = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "send-1-abcdefgh", mode: "send", tableNumber: "7", lines: [{ productId: bia, qty: 1 }] });
    const b = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "send-2-abcdefgh", mode: "print", tableNumber: "7", lines: [{ productId: soda, qty: 1 }] });
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "send-3-abcdefgh", mode: "send", lines: [{ productId: soda, qty: 1 }] }); // never sent
    expect(await asCashier.query(api.waiterOrders.listForBills, {})).toHaveLength(0);

    await asWaiter.mutation(api.waiterOrders.sendBillToCashier, { orderIds: [a.orderId, b.orderId] });
    await asWaiter.mutation(api.waiterOrders.sendBillToCashier, { orderIds: [a.orderId] }); // sending twice is harmless
    const seen = await asCashier.query(api.waiterOrders.listForBills, {});
    expect(seen.map((o) => String(o._id)).sort()).toEqual([String(a.orderId), String(b.orderId)].sort()); // only the SENT ones, not the third order
    expect((await asCashier.query(api.waiterOrders.billSummary, { orderIds: [a.orderId, b.orderId] })).total).toBe(2000 + 1000);
    expect(await asWaiter.query(api.waiterOrders.listForBills, {})).toHaveLength(1); // sent bills leave the waiter active list; history remains searchable

    expect(await asWaiter2.query(api.waiterOrders.listForBills, {})).toHaveLength(0); // another waiter never sees them
    expect(await asCashierOther.query(api.waiterOrders.listForBills, {})).toHaveLength(0); // nor a cashier of another business

    await asCashier.mutation(api.waiterOrders.markBillPrinted, { orderIds: [a.orderId, b.orderId] });
    expect(await asCashier.query(api.waiterOrders.listForBills, {})).toHaveLength(0); // printed bills leave the list
  });

  it("Invoice Finder searches archived Selling Point bills by invoice number or customer, scoped to the waiter and cashier", async () => {
    const { t, asWaiter, asWaiter2, asCashier, asCashierOther, bia } = await setup();
    const a = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "finder-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] });
    await asWaiter.mutation(api.waiterOrders.sendBillToCashier, { orderIds: [a.orderId] });
    await asCashier.mutation(api.waiterOrders.markBillPrinted, { orderIds: [a.orderId] });
    const invoiceNo = await t.run(async ctx => (await ctx.db.get("waiterOrders", a.orderId))?.invoiceNo ?? "");
    const byName = await asWaiter.query(api.waiterOrders.searchBillsForFinder, { search: "Mteja" });
    const byNumber = await asWaiter.query(api.waiterOrders.searchBillsForFinder, { search: invoiceNo });
    expect(byNumber.map(x => x._id)).toEqual([a.orderId]);
    expect(byName.map(x => x._id)).toEqual([a.orderId]);
    expect(await asCashier.query(api.waiterOrders.searchBillsForFinder, { search: invoiceNo })).toHaveLength(1);
    expect(await asWaiter2.query(api.waiterOrders.searchBillsForFinder, { search: invoiceNo })).toHaveLength(0);
    expect(await asCashierOther.query(api.waiterOrders.searchBillsForFinder, { search: invoiceNo })).toHaveLength(0);
  });

  it("only a waiter sends his OWN orders; a cashier cannot send, nobody can send somebody else's order", async () => {
    const { asWaiter, asWaiter2, asCashier, bia } = await setup();
    const a = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "own-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] });
    await expect(asWaiter2.mutation(api.waiterOrders.sendBillToCashier, { orderIds: [a.orderId] })).rejects.toThrow();
    await expect(asCashier.mutation(api.waiterOrders.sendBillToCashier, { orderIds: [a.orderId] })).rejects.toThrow();
    await expect(asWaiter.mutation(api.waiterOrders.sendBillToCashier, { orderIds: [] })).rejects.toThrow();
  });

  it("another business never sees or totals these orders", async () => {
    const { asWaiter, asCashierOther, bia } = await setup();
    const a = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "iso-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] });
    expect(await asCashierOther.query(api.waiterOrders.listForBills, {})).toHaveLength(0);
    await expect(asCashierOther.query(api.waiterOrders.billSummary, { orderIds: [a.orderId] })).rejects.toThrow();
  });
});

describe("Cashier: staff code", () => {
  it("finds the staff member by code and shows sales, outstanding and bills; wrong/other-business codes find nothing", async () => {
    const { asWaiter, asCashier, asCashierOther, bia } = await setup();
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "st-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] });
    const r = await asCashier.query(api.waiterDirectory.byStaffCode, { code: " w01 ", from: day, to: day });
    expect(r?.staff.name).toBe("juma");
    expect(r?.totals).toMatchObject({ invoices: 1, sales: 6000, paid: 1000, outstanding: 5000 });
    expect(r?.bills).toEqual({ count: 1, total: 2000 });
    expect(r?.invoices[0].outstanding).toBe(5000);
    expect(await asCashier.query(api.waiterDirectory.byStaffCode, { code: "NOPE", from: day, to: day })).toBeNull();
    expect(await asCashierOther.query(api.waiterDirectory.byStaffCode, { code: "W01", from: day, to: day })).toBeNull();
  });

  it("a waiter cannot use the cashier lookup", async () => {
    const { asWaiter } = await setup();
    await expect(asWaiter.query(api.waiterDirectory.byStaffCode, { code: "W02", from: day, to: day })).rejects.toThrow();
  });

  it("staff codes are unique inside a business (case-insensitive) and can be cleared", async () => {
    const { asBoss, waiter, waiter2 } = await setup();
    await expect(asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter2, staffCode: "w01" })).rejects.toThrow(/inatumika/);
    await asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter2, staffCode: "k9" });
    await asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter, staffCode: "" });
    await expect(asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter2, staffCode: "bad code" })).rejects.toThrow();
  });
});

describe("Selling Point staff have no Dashboard", () => {
  it("the personal dashboard query refuses a waiter", async () => {
    const { asWaiter } = await setup();
    await expect(asWaiter.query(api.dashboard.getMyDashboard, { from: day, today: day })).rejects.toThrow(/Forbidden/);
  });
});

describe("Cashier: atomic multi-invoice settlement", () => {
  async function withInvoices() {
    const s = await setup();
    const extra = await s.t.run(async (ctx) => {
      const [first] = await ctx.db.query("invoices").collect();
      const mk = (no: string, total: number, by: Id<"users">) => ctx.db.insert("invoices", { tenantId: s.tenantId, invoiceNo: no, invoiceDate: day, clientId: first.clientId, subtotal: total, discount: 0, taxAmount: 0, total, amountPaid: 0, outstanding: total, paymentStatus: "unpaid", status: "posted", createdBy: by });
      return { inv1: first._id, inv2: await mk("INV-2", 4000, s.waiter), foreign: await mk("INV-X", 1000, s.waiter2) };
    });
    const state = async () => t2(s.t, extra);
    return { ...s, ...extra, state };
  }
  const t2 = async (t: ReturnType<typeof convexTest>, ids: { inv1: Id<"invoices">; inv2: Id<"invoices"> }) => t.run(async (ctx) => ({
    a: (await ctx.db.get("invoices", ids.inv1))!.outstanding, b: (await ctx.db.get("invoices", ids.inv2))!.outstanding,
    pays: (await ctx.db.query("customerPayments").collect()).length, audits: (await ctx.db.query("auditLogs").collect()).filter((l) => l.action === "staff_settlement").length,
  }));

  it("pays several invoices together with split methods; balances, payments and audit log are right", async () => {
    const { asCashier, waiter, inv1, inv2, t, state } = await withInvoices();
    // INV-1 owes 5000, INV-2 owes 4000: 6000 cash + 3000 mobile
    const r = await asCashier.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [
      { invoiceId: inv1, splits: [{ method: "cash", amount: 5000 }] },
      { invoiceId: inv2, splits: [{ method: "cash", amount: 1000 }, { method: "mobile", amount: 3000 }] },
    ] });
    expect(r.total).toBe(9000);
    expect(await state()).toMatchObject({ a: 0, b: 0, pays: 3, audits: 1 });
    const pays = await t.run(async (ctx) => ctx.db.query("customerPayments").collect());
    expect(pays.filter((p) => p.paymentMethod === "cash").reduce((n, p) => n + p.amount, 0)).toBe(6000);
    expect(pays.filter((p) => p.paymentMethod === "mobile").reduce((n, p) => n + p.amount, 0)).toBe(3000);
  });

  it("partial settlement leaves the right remaining balance", async () => {
    const { asCashier, waiter, inv1, inv2, state } = await withInvoices();
    await asCashier.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [{ invoiceId: inv2, splits: [{ method: "cash", amount: 1500 }] }] });
    expect(await state()).toMatchObject({ a: 5000, b: 2500, pays: 1 });
    void inv1;
  });

  it("if one invoice fails, NOTHING is recorded (no payments, balances unchanged, no audit)", async () => {
    const { asCashier, waiter, inv1, inv2, state } = await withInvoices();
    await expect(asCashier.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [
      { invoiceId: inv1, splits: [{ method: "cash", amount: 5000 }] },
      { invoiceId: inv2, splits: [{ method: "cash", amount: 9999 }] }, // more than the 4000 owed
    ] })).rejects.toThrow();
    expect(await state()).toMatchObject({ a: 5000, b: 4000, pays: 0, audits: 0 });
  });

  it("refuses another staff member's invoice, duplicates, empty lists and non-cashiers - all atomically", async () => {
    const { asCashier, asWaiter, waiter, inv1, inv2, foreign, state } = await withInvoices();
    const pay = (invoiceId: Id<"invoices">, amount: number) => ({ invoiceId, splits: [{ method: "cash", amount }] });
    await expect(asCashier.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [pay(inv1, 1000), pay(foreign, 1000)] })).rejects.toThrow(/si ya mhudumu/);
    await expect(asCashier.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [pay(inv1, 1000), pay(inv1, 1000)] })).rejects.toThrow(/mara mbili/);
    await expect(asCashier.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [] })).rejects.toThrow();
    await expect(asWaiter.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [pay(inv1, 1000)] })).rejects.toThrow(/Forbidden/);
    expect(await state()).toMatchObject({ a: 5000, b: 4000, pays: 0, audits: 0 });
    void inv2;
  });

  it("another business's cashier cannot settle these invoices", async () => {
    const { asCashierOther, waiter, inv1, state } = await withInvoices();
    await expect(asCashierOther.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [{ invoiceId: inv1, splits: [{ method: "cash", amount: 1000 }] }] })).rejects.toThrow();
    expect(await state()).toMatchObject({ a: 5000, pays: 0, audits: 0 });
  });

  it("settling never touches stock", async () => {
    const { asCashier, waiter, inv1, bia, qty, moves } = await withInvoices();
    await asCashier.mutation(api.sales.settleInvoices, { staffId: waiter, paymentDate: day, allocations: [{ invoiceId: inv1, splits: [{ method: "cash", amount: 5000 }] }] });
    expect(await qty(bia)).toBe(10); expect(await moves()).toBe(0);
  });
});

describe("Staff code across departments", () => {
  it("is unique business-wide even when the other user is in a different department; lookup stays inside the cashier's department", async () => {
    const { t, asBoss, asCashier, tenantId, waiter, waiter2, cashier } = await setup();
    const [brA, brB] = await t.run(async (ctx) => {
      const now = new Date().toISOString();
      return [await ctx.db.insert("branches", { tenantId, name: "Bar", code: "BR", isActive: true, createdAt: now }), await ctx.db.insert("branches", { tenantId, name: "Jikoni", code: "JK", isActive: true, createdAt: now })];
    });
    await t.run(async (ctx) => { await ctx.db.patch("users", waiter, { branchId: brA }); await ctx.db.patch("users", cashier, { branchId: brA }); await ctx.db.patch("users", waiter2, { branchId: brB, staffCode: undefined }); });
    await expect(asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter2, staffCode: "w01" })).rejects.toThrow(/inatumika/); // W01 belongs to the other department
    await asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter2, staffCode: "J77" });
    expect((await asCashier.query(api.waiterDirectory.byStaffCode, { code: "W01", from: day, to: day }))?.staff.name).toBe("juma");
    expect(await asCashier.query(api.waiterDirectory.byStaffCode, { code: "J77", from: day, to: day })).toBeNull(); // other department
  });
});


describe("Selling Point: Invoice Finder actions", () => {
  it("edits a bill in place, keeps its invoice number, updates stock, then cancels without deleting history", async () => {
    const { asEditor, bia, qty, t } = await setup();
    const created = await asEditor.mutation(api.waiterOrders.submit, {
      clientKey: "finder-edit-123456",
      mode: "send",
      customerName: "Mteja wa awali",
      lines: [{ productId: bia, qty: 2 }],
    });
    const before = await t.run(async (ctx) => ctx.db.get("waiterOrders", created.orderId));
    expect(before?.invoiceNo).toBeTruthy();
    expect(await qty(bia)).toBe(8);

    await asEditor.mutation(api.waiterOrders.editBillFromFinder, {
      orderId: created.orderId,
      customerName: "Mteja mpya",
      lines: [{ productId: bia, qty: 3, unitPrice: 1800 }],
    });
    const edited = await t.run(async (ctx) => ctx.db.get("waiterOrders", created.orderId));
    expect(edited?.invoiceNo).toBe(before?.invoiceNo);
    expect(edited?.customerName).toBe("Mteja mpya");
    expect(edited?.total).toBe(5400);
    expect(await qty(bia)).toBe(7);

    await asEditor.mutation(api.waiterOrders.cancelBillFromFinder, {
      orderId: created.orderId,
      reason: "Jaribio la kufuta",
    });
    const cancelled = await t.run(async (ctx) => ctx.db.get("waiterOrders", created.orderId));
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.invoiceNo).toBe(before?.invoiceNo);
    expect(await qty(bia)).toBe(10);
    const history = await asEditor.query(api.waiterOrders.searchBillsForFinder, { search: before!.invoiceNo! });
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("cancelled");
  });

  it("a paid or received bill keeps the role rights visible (mayEdit / mayVoid) but is locked, with the reason", async () => {
    const { t, asBoss, asWaiter, boss, tenantId, bia } = await setup();
    await t.run(async (ctx) => ctx.db.patch("users", boss, { tenantId }));
    const open = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "locked-open-123456", mode: "print", customerName: "A", lines: [{ productId: bia, qty: 1 }] });
    const paid = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "locked-paid-123456", mode: "print", customerName: "B", lines: [{ productId: bia, qty: 1 }] });
    await t.run(async (ctx) => ctx.db.patch("waiterOrders", paid.orderId, { paidAmount: 2000 }));
    const find = async (id: typeof open.orderId) => {
      const no = (await t.run(async (ctx) => ctx.db.get("waiterOrders", id)))!.invoiceNo!;
      return (await asBoss.query(api.waiterOrders.searchBillsForFinder, { search: no }))[0];
    };
    const o = await find(open.orderId);
    expect([o.mayEdit, o.mayVoid, o.canEdit, o.canVoid, o.lockReason]).toEqual([true, true, true, true, ""]);
    const p = await find(paid.orderId);
    expect([p.mayEdit, p.mayVoid, p.canEdit, p.canVoid, p.lockReason]).toEqual([true, true, false, false, "paid"]); // Super Admin too: the button shows, disabled, with the reason
    await expect(asBoss.mutation(api.waiterOrders.cancelBillFromFinder, { orderId: paid.orderId, reason: "jaribio" })).rejects.toThrow();
  });

  it("lets Super Admin find and administer another waiter's bill inside the selected business", async () => {
    const { t, asBoss, asWaiter, boss, tenantId, bia } = await setup();
    await t.run(async (ctx) => ctx.db.patch("users", boss, { tenantId }));
    const created = await asWaiter.mutation(api.waiterOrders.submit, {
      clientKey: "superadmin-finder-12345", mode: "print", customerName: "Mteja wa Juma",
      lines: [{ productId: bia, qty: 1 }],
    });
    const before = await t.run(async (ctx) => ctx.db.get("waiterOrders", created.orderId));
    const found = await asBoss.query(api.waiterOrders.searchBillsForFinder, { search: before!.invoiceNo! });
    expect(found).toHaveLength(1);
    expect(found[0].canEdit).toBe(true);
    expect(found[0].canVoid).toBe(true);
    await asBoss.mutation(api.waiterOrders.editBillFromFinder, {
      orderId: created.orderId, customerName: "Mteja aliyerekebishwa",
      lines: [{ productId: bia, qty: 1, unitPrice: 2500 }],
    });
    const edited = await t.run(async (ctx) => ctx.db.get("waiterOrders", created.orderId));
    expect(edited?.customerName).toBe("Mteja aliyerekebishwa");
    expect(edited?.invoiceNo).toBe(before?.invoiceNo);
  });

  it("refuses to edit or cancel a bill after cashier settlement", async () => {
    const { asEditor, bia, t } = await setup();
    const created = await asEditor.mutation(api.waiterOrders.submit, {
      clientKey: "finder-locked-12345",
      mode: "send",
      lines: [{ productId: bia, qty: 1 }],
    });
    await t.run(async (ctx) => ctx.db.patch("waiterOrders", created.orderId, { settledAt: new Date().toISOString(), paidAmount: 2000 }));
    await expect(asEditor.mutation(api.waiterOrders.editBillFromFinder, {
      orderId: created.orderId, customerName: "Badiliko", lines: [{ productId: bia, qty: 2, unitPrice: 2000 }],
    })).rejects.toThrow(/malipo/i);
    await expect(asEditor.mutation(api.waiterOrders.cancelBillFromFinder, {
      orderId: created.orderId, reason: "Test",
    })).rejects.toThrow(/malipo/i);
  });
});
