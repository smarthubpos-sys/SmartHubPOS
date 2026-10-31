import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

/**
 * Fix 3 - INVOICE NUMBER, SEARCH, EDIT & CANCELLATION.
 *  - every invoice gets the next number of its business (00001, 00002, 00003 ...), across departments, never reused;
 *  - the invoice can be found by its number (only inside the user's own business / department);
 *  - a user with the right can open, print, correct or cancel it; stock, payments, debts and reports follow in the same transaction.
 */
const now = new Date().toISOString();
const DAY = now.slice(0, 10);

async function setup(opts: { prefix?: string; departments?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "Shop B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    // Departments only in the tests about departments: in a business WITH departments a user who is not tied to one must pick it before saving.
    const bar = opts.departments ? await ctx.db.insert("branches", { tenantId: tenantA, name: "Bar", code: "BAR", isActive: true, createdAt: now }) : undefined;
    const kitchen = opts.departments ? await ctx.db.insert("branches", { tenantId: tenantA, name: "Kitchen", code: "KIT", isActive: true, createdAt: now }) : undefined;
    if (opts.prefix !== undefined) await ctx.db.insert("companySettings", { tenantId: tenantA, companyName: "Shop A", currency: "TZS", currencySymbol: "TSh", decimalPlaces: 2, invoicePrefix: opts.prefix });
    const mk = (tenantId: Id<"tenants">, username: string, role: string, extra: Record<string, unknown> = {}) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    const owner = await mk(tenantA, "owner", "manager");
    const barMgr = await mk(tenantA, "barmgr", "manager", bar ? { branchId: bar } : {});
    const kitMgr = await mk(tenantA, "kitmgr", "manager", kitchen ? { branchId: kitchen } : {});
    const cashier = await mk(tenantA, "cash", "cashier");
    const cashierEdit = await mk(tenantA, "cashedit", "cashier", { extraPermissions: ["sales.edit", "sales.void"] });
    const foreign = await mk(tenantB, "foreign", "manager");
    const mkClient = (code: string, branchId?: Id<"branches">, extra: Record<string, unknown> = {}) => ctx.db.insert("clients", { tenantId: tenantA, ...(branchId ? { branchId } : {}), code, name: `Client ${code}`, openingBalance: 0, creditPolicy: "allow", isActive: true, ...extra });
    const client = await mkClient("C1");
    const clientBar = await mkClient("CB", bar);
    const clientKit = await mkClient("CK", kitchen);
    const limited = await mkClient("C2", undefined, { creditPolicy: "block", creditLimit: 300 });
    const mkProduct = (itemCode: string, name: string, branchId?: Id<"branches">) => ctx.db.insert("products", { tenantId: tenantA, ...(branchId ? { branchId } : {}), itemCode, name, openingQty: 10, currentQty: 10, sellingPrice: 100, isActive: true });
    const product = await mkProduct("P1", "Beer");
    const product2 = await mkProduct("P2", "Soda");
    const barProduct = await mkProduct("PB", "Bar Beer", bar);
    const kitProduct = await mkProduct("PK", "Kitchen Rice", kitchen);
    return { tenantA, tenantB, bar, kitchen, owner, barMgr, kitMgr, cashier, cashierEdit, foreign, client, clientBar, clientKit, limited, product, product2, barProduct, kitProduct };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  return { t, as, ...ids };
}

const qtyOf = (t: Awaited<ReturnType<typeof setup>>["t"], id: Id<"products">) => t.run(async (ctx) => (await ctx.db.get("products", id))?.currentQty);

describe("invoice numbers", () => {
  it("follow each other inside the business, across departments, and are unique", async () => {
    const { as, owner, barMgr, kitMgr, clientBar, clientKit, barProduct, kitProduct } = await setup({ departments: true });
    const a = await as(barMgr).mutation(api.sales.createInvoice, { clientId: clientBar, invoiceDate: DAY, lines: [{ productId: barProduct, qty: 1, unitPrice: 100 }] });
    const b = await as(kitMgr).mutation(api.sales.createInvoice, { clientId: clientKit, invoiceDate: DAY, lines: [{ productId: kitProduct, qty: 1, unitPrice: 100 }] });
    const c = await as(barMgr).mutation(api.sales.createInvoice, { clientId: clientBar, invoiceDate: DAY, lines: [{ productId: barProduct, qty: 1, unitPrice: 100 }] });
    expect([a.invoiceNo, b.invoiceNo, c.invoiceNo]).toEqual(["INV-00001", "INV-00002", "INV-00003"]);
    expect(new Set([a.invoiceNo, b.invoiceNo, c.invoiceNo]).size).toBe(3);
    expect(owner).toBeTruthy();
  });

  it("with an empty prefix (Document Numbering) they are plain 00001, 00002, 00003", async () => {
    const { as, owner, client, product } = await setup({ prefix: "" });
    const nos: string[] = [];
    for (let i = 0; i < 3; i++) nos.push((await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] })).invoiceNo);
    expect(nos).toEqual(["00001", "00002", "00003"]);
  });

  it("a cancelled invoice's number is never given to a new invoice", async () => {
    const { as, owner, client, product } = await setup();
    const first = await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] });
    await as(owner).mutation(api.sales.voidInvoice, { invoiceId: first.invoiceId, reason: "Kosa la kuingiza invoice" });
    const second = await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] });
    expect(first.invoiceNo).toBe("INV-00001");
    expect(second.invoiceNo).toBe("INV-00002");
  });

  it("a retried submit (same requestKey) returns the same invoice and number", async () => {
    const { t, as, owner, client, product } = await setup();
    const args = { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }], requestKey: "k1" };
    const r1 = await as(owner).mutation(api.sales.createInvoice, args);
    const r2 = await as(owner).mutation(api.sales.createInvoice, args);
    expect(r2.invoiceNo).toBe(r1.invoiceNo);
    expect(r2.duplicate).toBe(true);
    expect(await qtyOf(t, product)).toBe(9); // sold once
  });
});

describe("search by invoice number", () => {
  it("finds an invoice by 1, 00001 or the full number, and nothing for an unknown number", async () => {
    const { as, owner, client, product } = await setup();
    await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] });
    for (const term of ["1", "00001", "INV-00001", "#00001", "inv-00001"]) {
      const found = await as(owner).query(api.sales.searchInvoices, { invoiceNo: term });
      expect(found.map((r) => r.invoiceNo), term).toEqual(["INV-00001"]);
    }
    expect(await as(owner).query(api.sales.searchInvoices, { invoiceNo: "99999" })).toEqual([]);
    expect(await as(owner).query(api.sales.searchInvoices, { invoiceNo: "   " })).toEqual([]);
  });

  it("works with an empty prefix too", async () => {
    const { as, owner, client, product } = await setup({ prefix: "" });
    await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] });
    expect((await as(owner).query(api.sales.searchInvoices, { invoiceNo: "00001" })).map((r) => r.invoiceNo)).toEqual(["00001"]);
    expect((await as(owner).query(api.sales.searchInvoices, { invoiceNo: "1" })).map((r) => r.invoiceNo)).toEqual(["00001"]);
  });

  it("never shows another business or another department's invoice", async () => {
    const { as, owner, barMgr, kitMgr, foreign, clientBar, barProduct } = await setup({ departments: true });
    await as(barMgr).mutation(api.sales.createInvoice, { clientId: clientBar, invoiceDate: DAY, lines: [{ productId: barProduct, qty: 1, unitPrice: 100 }] });
    expect((await as(barMgr).query(api.sales.searchInvoices, { invoiceNo: "1" })).map((r) => r.invoiceNo)).toEqual(["INV-00001"]);
    expect((await as(owner).query(api.sales.searchInvoices, { invoiceNo: "1" })).map((r) => r.invoiceNo)).toEqual(["INV-00001"]); // whole-business view
    expect(await as(kitMgr).query(api.sales.searchInvoices, { invoiceNo: "1" })).toEqual([]); // other department
    expect(await as(foreign).query(api.sales.searchInvoices, { invoiceNo: "1" })).toEqual([]); // other business
    const id = (await as(owner).query(api.sales.searchInvoices, { invoiceNo: "1" }))[0]._id;
    expect(await as(kitMgr).query(api.sales.invoiceFull, { invoiceId: id })).toBeNull();
    expect(await as(foreign).query(api.sales.invoiceFull, { invoiceId: id })).toBeNull();
  });

  it("tells the screen what the user may do (print / edit / cancel)", async () => {
    const { as, owner, cashier, cashierEdit, client, product } = await setup();
    await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] });
    const rights = async (u: Id<"users">) => { const r = (await as(u).query(api.sales.searchInvoices, { invoiceNo: "1" }))[0]; return { canPrint: r.canPrint, canEdit: r.canEdit, canVoid: r.canVoid }; };
    expect(await rights(owner)).toEqual({ canPrint: true, canEdit: true, canVoid: true });
    expect(await rights(cashier)).toEqual({ canPrint: true, canEdit: false, canVoid: false });
    expect(await rights(cashierEdit)).toEqual({ canPrint: true, canEdit: true, canVoid: true });
  });

  it("opens the invoice with its lines; cost of goods is hidden from a cashier", async () => {
    const { as, owner, cashier, client, product } = await setup();
    const inv = await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 2, unitPrice: 100 }] });
    const asOwner = await as(owner).query(api.sales.invoiceFull, { invoiceId: inv.invoiceId });
    expect(asOwner?.lines).toHaveLength(1);
    expect(asOwner?.lines[0]).toMatchObject({ productName: "Beer", qty: 2, unitPrice: 100, lineTotal: 200 });
    expect(asOwner?.lines[0]).toHaveProperty("costAtSale");
    const asCashier = await as(cashier).query(api.sales.invoiceFull, { invoiceId: inv.invoiceId });
    expect(asCashier?.lines[0]).not.toHaveProperty("costAtSale");
  });
});

describe("correcting an invoice (edit)", () => {
  async function sold() {
    const s = await setup();
    // 4 x 100 = 400, 200 paid in cash, 200 owed; stock 10 -> 6.
    const inv = await s.as(s.owner).mutation(api.sales.createInvoice, { clientId: s.client, invoiceDate: DAY, lines: [{ productId: s.product, qty: 4, unitPrice: 100 }], paymentAmount: 200, paymentMethod: "cash" });
    return { ...s, inv };
  }

  it("fewer items: stock goes back, the debt shrinks, the number stays and the revision goes up", async () => {
    const { t, as, owner, product, inv } = await sold();
    expect(await qtyOf(t, product)).toBe(6);
    const r = await as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "Mteja alirudisha 2", lines: [{ productId: product, qty: 2, unitPrice: 100 }] });
    expect(r).toMatchObject({ invoiceNo: "INV-00001", revision: 1, total: 200, amountPaid: 200, outstanding: 0, refunded: 0 });
    expect(await qtyOf(t, product)).toBe(8);
    const after = await t.run(async (ctx) => ({ inv: await ctx.db.get("invoices", inv.invoiceId), lines: await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", inv.invoiceId)).collect(), moves: await ctx.db.query("stockMovements").collect() }));
    expect(after.inv).toMatchObject({ total: 200, outstanding: 0, paymentStatus: "paid", status: "posted", revision: 1 });
    expect(after.lines).toHaveLength(1);
    expect(after.moves.some((m) => m.referenceType === "invoice_edit" && m.qtyIn === 2)).toBe(true);
  });

  it("more items: stock goes down, the customer owes the difference", async () => {
    const { t, as, owner, product, inv } = await sold();
    const r = await as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "Ameongeza 2", lines: [{ productId: product, qty: 6, unitPrice: 100 }] });
    expect(r).toMatchObject({ total: 600, amountPaid: 200, outstanding: 400, refunded: 0 });
    expect(await qtyOf(t, product)).toBe(4);
  });

  it("a total lower than what was paid refunds the excess (a negative payment row) and keeps the cash books straight", async () => {
    const { t, as, owner, product, inv } = await sold();
    const r = await as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "Ameacha 3", lines: [{ productId: product, qty: 1, unitPrice: 100 }], refundMethod: "cash" });
    expect(r).toMatchObject({ total: 100, amountPaid: 100, outstanding: 0, refunded: 100 });
    const pays = await t.run(async (ctx) => await ctx.db.query("customerPayments").collect());
    expect(pays.map((p) => p.amount).sort((x, y) => x - y)).toEqual([-100, 200]);
    expect(pays.reduce((n, p) => n + p.amount, 0)).toBe(100); // net money in = new amount paid
    const lines = await t.run(async (ctx) => await ctx.db.query("journalLines").collect());
    expect(lines.reduce((n, l) => n + l.debit, 0)).toBeCloseTo(lines.reduce((n, l) => n + l.credit, 0), 2); // books still balance
  });

  it("can change the price and add another product", async () => {
    const { t, as, owner, product, product2, inv } = await sold();
    const r = await as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "Bidhaa nyingine", lines: [{ productId: product, qty: 1, unitPrice: 150 }, { productId: product2, qty: 2, unitPrice: 100, discount: 50 }] });
    expect(r.total).toBe(150 + 150);
    expect(await qtyOf(t, product)).toBe(9); // 10 - 1
    expect(await qtyOf(t, product2)).toBe(8);
  });

  it("reports show the corrected invoice", async () => {
    const { as, owner, product, inv } = await sold();
    await as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "Marekebisho", lines: [{ productId: product, qty: 2, unitPrice: 100 }] });
    const reg = await as(owner).query(api.sales.salesRegisters, { startDate: DAY, endDate: DAY });
    const row = reg.invoices.find((i) => i.invoiceNo === "INV-00001");
    expect(row).toMatchObject({ total: 200, amountPaid: 200, outstanding: 0 });
    expect(reg.invoices.filter((i) => i.invoiceNo === "INV-00001")).toHaveLength(1);
  });

  it("refuses without a reason, with no items, or when stock is not enough - and changes nothing", async () => {
    const { t, as, owner, product, inv } = await sold();
    await expect(as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "  ", lines: [{ productId: product, qty: 1, unitPrice: 100 }] })).rejects.toThrow(/sababu/);
    await expect(as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "x", lines: [] })).rejects.toThrow(/angalau bidhaa moja/);
    await expect(as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "x", lines: [{ productId: product, qty: 11, unitPrice: 100 }] })).rejects.toThrow(/Stock haitoshi/);
    expect(await qtyOf(t, product)).toBe(6);
    const same = await t.run(async (ctx) => await ctx.db.get("invoices", inv.invoiceId));
    expect(same).toMatchObject({ total: 400, outstanding: 200 });
    expect(same?.revision ?? 0).toBe(0);
  });

  it("respects the customer's credit limit when the correction makes him owe more", async () => {
    const { as, owner, limited, product } = await setup();
    const inv = await as(owner).mutation(api.sales.createInvoice, { clientId: limited, invoiceDate: DAY, lines: [{ productId: product, qty: 2, unitPrice: 100 }], paymentAmount: 200, paymentMethod: "cash" });
    await as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "ndani ya kikomo", lines: [{ productId: product, qty: 5, unitPrice: 100 }] }); // owes 300 = limit
    await expect(as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "juu ya kikomo", lines: [{ productId: product, qty: 6, unitPrice: 100 }] })).rejects.toThrow(/kikomo cha mkopo/);
  });

  it("needs the sales.edit right: a plain cashier is refused, a cashier given it by the owner can, another business cannot", async () => {
    const { as, owner, cashier, cashierEdit, foreign, client, product } = await setup();
    const inv = await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] });
    const edit = { invoiceId: inv.invoiceId, reason: "test", lines: [{ productId: product, qty: 2, unitPrice: 100 }] };
    await expect(as(cashier).mutation(api.sales.editInvoice, edit)).rejects.toThrow(/Forbidden/);
    await expect(as(foreign).mutation(api.sales.editInvoice, edit)).rejects.toThrow(/haipatikani/);
    await as(cashierEdit).mutation(api.sales.editInvoice, edit);
  });

  it("a department manager cannot edit another department's invoice, nor use another department's product", async () => {
    const { as, barMgr, kitMgr, clientBar, barProduct, kitProduct } = await setup({ departments: true });
    const barInv = await as(barMgr).mutation(api.sales.createInvoice, { clientId: clientBar, invoiceDate: DAY, lines: [{ productId: barProduct, qty: 1, unitPrice: 100 }] });
    await expect(as(kitMgr).mutation(api.sales.editInvoice, { invoiceId: barInv.invoiceId, reason: "x", lines: [{ productId: kitProduct, qty: 1, unitPrice: 100 }] })).rejects.toThrow(/haipatikani/);
    await expect(as(barMgr).mutation(api.sales.editInvoice, { invoiceId: barInv.invoiceId, reason: "x", lines: [{ productId: kitProduct, qty: 1, unitPrice: 100 }] })).rejects.toThrow(/haipatikani/);
    await as(barMgr).mutation(api.sales.editInvoice, { invoiceId: barInv.invoiceId, reason: "ok", lines: [{ productId: barProduct, qty: 3, unitPrice: 100 }] });
  });

  it("a cancelled invoice cannot be edited", async () => {
    const { as, owner, product, inv } = await sold();
    await as(owner).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Kosa la kuingiza invoice" });
    await expect(as(owner).mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "x", lines: [{ productId: product, qty: 1, unitPrice: 100 }] })).rejects.toThrow(/imebatilishwa/);
  });
});

describe("cancelling (deleting) an invoice", () => {
  it("puts the stock back, refunds the payments, clears the debt and drops it from the reports", async () => {
    const { t, as, owner, client, product } = await setup();
    const inv = await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 4, unitPrice: 100 }], paymentAmount: 150, paymentMethod: "cash" });
    expect(await qtyOf(t, product)).toBe(6);
    const r = await as(owner).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Mteja amebadilisha mawazo" });
    expect(r).toEqual({ invoiceNo: "INV-00001", refunded: 150 });
    expect(await qtyOf(t, product)).toBe(10);
    const after = await t.run(async (ctx) => await ctx.db.get("invoices", inv.invoiceId));
    expect(after).toMatchObject({ status: "cancelled", outstanding: 0, amountPaid: 0 });
    const reg = await as(owner).query(api.sales.salesRegisters, { startDate: DAY, endDate: DAY });
    expect(reg.invoices.find((i) => i.invoiceNo === "INV-00001")).toBeUndefined();
    // The number can still be searched (status cancelled) so nobody wonders where it went.
    const found = await as(owner).query(api.sales.searchInvoices, { invoiceNo: "1" });
    expect(found[0]).toMatchObject({ invoiceNo: "INV-00001", status: "cancelled" });
  });

  it("needs the sales.void right and a valid reason", async () => {
    const { as, owner, cashier, cashierEdit, client, product } = await setup();
    const inv = await as(owner).mutation(api.sales.createInvoice, { clientId: client, invoiceDate: DAY, lines: [{ productId: product, qty: 1, unitPrice: 100 }] });
    await expect(as(cashier).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Kosa la kuingiza invoice" })).rejects.toThrow(/Forbidden|ruhusa/);
    await expect(as(owner).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "sababu yoyote" })).rejects.toThrow(/sababu halali/);
    await expect(as(owner).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Sababu nyingine" })).rejects.toThrow(/Eleza sababu/);
    await as(cashierEdit).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Sababu nyingine", reasonDetails: "Alighairi" });
  });

  it("cannot cancel an invoice of another department or business", async () => {
    const { as, kitMgr, foreign, barMgr, clientBar, barProduct } = await setup({ departments: true });
    const inv = await as(barMgr).mutation(api.sales.createInvoice, { clientId: clientBar, invoiceDate: DAY, lines: [{ productId: barProduct, qty: 1, unitPrice: 100 }] });
    await expect(as(kitMgr).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Kosa la kuingiza invoice" })).rejects.toThrow(/haipatikani/);
    await expect(as(foreign).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Kosa la kuingiza invoice" })).rejects.toThrow(/haipatikani/);
  });
});
