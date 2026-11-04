import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

/** Invoice Finder: nothing is listed without a search; search by number or customer; Print / Edit / Cancel follow the user's rights. */
const now = new Date().toISOString();
const DAY = now.slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "Shop B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const mk = (tenantId: Id<"tenants">, username: string, role: string, extra: Record<string, unknown> = {}) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    const manager = await mk(tenantA, "mgr", "manager");
    const cashier = await mk(tenantA, "cash", "cashier");
    const viewer = await mk(tenantA, "view", "viewer");
    const foreign = await mk(tenantB, "foreign", "manager");
    const client = await ctx.db.insert("clients", { tenantId: tenantA, code: "C1", name: "Juma Hotel", phone: "0712000111", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const product = await ctx.db.insert("products", { tenantId: tenantA, itemCode: "P1", name: "Beer", openingQty: 100, currentQty: 100, sellingPrice: 100, isActive: true });
    return { manager, cashier, viewer, foreign, client, product };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  const sell = (who: Id<"users">) => as(who).mutation(api.sales.createInvoice, { clientId: ids.client, invoiceDate: DAY, lines: [{ productId: ids.product, qty: 1, unitPrice: 100 }] });
  return { t, as, sell, ...ids };
}

describe("Invoice Finder shows nothing until the user searches", () => {
  it("an empty or blank search returns no invoices at all, even when the business has many", async () => {
    const { as, sell, manager } = await setup();
    await sell(manager); await sell(manager);
    for (const term of ["", "   ", "#"]) expect(await as(manager).query(api.sales.searchInvoices, { invoiceNo: term }), term).toEqual([]);
  });

  it("a search returns at most 20 invoices", async () => {
    const { as, sell, manager } = await setup();
    for (let i = 0; i < 22; i++) await sell(manager);
    expect((await as(manager).query(api.sales.searchInvoices, { invoiceNo: "Juma" })).length).toBeLessThanOrEqual(20);
  });
});

describe("search by number or by customer", () => {
  it("finds the invoice by number, and by part of the customer's name or phone, whatever the letter case", async () => {
    const { as, sell, manager } = await setup();
    const inv = await sell(manager);
    const me = as(manager);
    expect((await me.query(api.sales.searchInvoices, { invoiceNo: "1" })).map((r) => r.invoiceNo)).toEqual([inv.invoiceNo]);
    for (const term of ["juma", "HOTEL", "0712000"]) expect((await me.query(api.sales.searchInvoices, { invoiceNo: term })).map((r) => r.invoiceNo), term).toEqual([inv.invoiceNo]);
    expect(await me.query(api.sales.searchInvoices, { invoiceNo: "ju" })).toEqual([]); // too short to be a name search
    expect(await me.query(api.sales.searchInvoices, { invoiceNo: "nobody" })).toEqual([]);
  });

  it("never finds another business's invoice, by number or by customer", async () => {
    const { as, sell, manager, foreign } = await setup();
    await sell(manager);
    expect(await as(foreign).query(api.sales.searchInvoices, { invoiceNo: "1" })).toEqual([]);
    expect(await as(foreign).query(api.sales.searchInvoices, { invoiceNo: "Juma" })).toEqual([]);
  });

  it("a user without sales access cannot search", async () => {
    const { as, viewer } = await setup();
    await expect(as(viewer).query(api.sales.searchInvoices, { invoiceNo: "1" })).rejects.toThrow();
  });
});

describe("Print, Edit and Cancel follow the user's rights", () => {
  it("manager: print, edit and cancel; cashier: print only", async () => {
    const { as, sell, manager, cashier } = await setup();
    await sell(manager);
    const m = (await as(manager).query(api.sales.searchInvoices, { invoiceNo: "1" }))[0];
    expect([m.canPrint, m.canEdit, m.canVoid]).toEqual([true, true, true]);
    const c = (await as(cashier).query(api.sales.searchInvoices, { invoiceNo: "1" }))[0];
    expect([c.canPrint, c.canEdit, c.canVoid]).toEqual([true, false, false]);
    const full = await as(cashier).query(api.sales.invoiceFull, { invoiceId: c._id });
    expect([full?.canPrint, full?.canEdit, full?.canVoid]).toEqual([true, false, false]);
  });

  it("Cancel: a cashier is refused and nothing changes; a manager cancels, stock returns and the invoice shows as cancelled", async () => {
    const { t, as, sell, manager, cashier, product } = await setup();
    const inv = await sell(manager);
    await expect(as(cashier).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Kosa la kuingiza invoice" })).rejects.toThrow(/Forbidden|sales\.void/);
    expect((await t.run((ctx) => ctx.db.get("invoices", inv.invoiceId)))?.status).not.toBe("cancelled");
    await as(manager).mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "Kosa la kuingiza invoice" });
    expect((await t.run((ctx) => ctx.db.get("invoices", inv.invoiceId)))?.status).toBe("cancelled");
    expect((await t.run((ctx) => ctx.db.get("products", product)))?.currentQty).toBe(100);
    expect((await as(manager).query(api.sales.searchInvoices, { invoiceNo: "1" }))[0].status).toBe("cancelled");
  });

  it("Edit: a cashier is refused, a manager can correct the quantity", async () => {
    const { as, sell, manager, cashier, product } = await setup();
    const inv = await sell(manager);
    const args = { invoiceId: inv.invoiceId, reason: "Mteja alibadilisha idadi", notes: "", discount: 0, taxRate: 0, lines: [{ productId: product, qty: 2, unitPrice: 100, discount: 0 }] };
    await expect(as(cashier).mutation(api.sales.editInvoice, args)).rejects.toThrow(/Forbidden|sales\.edit/);
    const r = await as(manager).mutation(api.sales.editInvoice, args);
    expect(r.total).toBe(200);
  });
});
