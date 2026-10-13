import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Club X", code: "X", isActive: true, createdByToken: "t", createdAt: "2026-01-01" });
    const bar = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "X-D1", isActive: true, createdAt: "2026-01-01" });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId, branchId: bar, isActive: true });
    const scope = { tenantId, branchId: bar };
    const client = await ctx.db.insert("clients", { ...scope, code: "C1", name: "Mteja Mmoja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const other = await ctx.db.insert("clients", { ...scope, code: "C2", name: "Mwingine", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const group = await ctx.db.insert("productGroups", { ...scope, code: "G", name: "Vinywaji", isActive: true } as any);
    void group;
    const product = await ctx.db.insert("products", { ...scope, itemCode: "ITM-1", name: "Bia", sellingPrice: 2000, openingQty: 100, currentQty: 100, isActive: true } as any);
    const mk = async (c: any, no: string, total: number, paid: number) => {
      const id = await ctx.db.insert("invoices", { ...scope, invoiceNo: no, invoiceDate: "2026-03-0" + no.slice(-1), clientId: c, subtotal: total, discount: 0, taxAmount: 0, total, amountPaid: paid, outstanding: total - paid, paymentStatus: paid ? "partial" : "unpaid", status: "posted", createdBy: mgr });
      await ctx.db.insert("invoiceLines", { invoiceId: id, productId: product, qty: 2, qtyStr: "2", unitPrice: total / 2, unitPriceStr: String(total / 2), lineTotal: total, lineTotalStr: String(total), costAtSale: 0, discount: 0 });
      return id;
    };
    const i1 = await mk(client, "INV-1", 4000, 0);
    const i2 = await mk(client, "INV-2", 6000, 1000);
    const i3 = await mk(client, "INV-3", 2000, 2000);
    const x1 = await mk(other, "INV-4", 8000, 0);
    return { mgr, client, i1, i2, i3, x1 };
  });
  return { t, as: t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" }), ...ids };
}

describe("customer bills built from sales invoices", () => {
  it("lists a customer's invoices and prints a bill only for the ones picked", async () => {
    const { as, client, i1, i2 } = await setup();
    const all = await as.query(api.customerBills.invoicesForClient, { clientId: client });
    expect(all.map((i: any) => i.invoiceNo).sort()).toEqual(["INV-1", "INV-2", "INV-3"]);
    expect((await as.query(api.customerBills.invoicesForClient, { clientId: client, onlyOpen: true })).map((i: any) => i.invoiceNo).sort()).toEqual(["INV-1", "INV-2"]);
    const bill = await as.query(api.customerBills.billData, { invoiceIds: [i2, i1] });
    expect(bill.invoices.map((i: any) => i.invoiceNo)).toEqual(["INV-1", "INV-2"]);
    expect(bill.totals).toMatchObject({ total: 10000, paid: 1000, outstanding: 9000 });
    expect(bill.department).toBe("Bar");
    expect(bill.invoices[0].lines[0].name).toBe("Bia");
  });

  it("refuses a bill that mixes customers or has nothing selected", async () => {
    const { as, i1, x1 } = await setup();
    await expect(as.query(api.customerBills.billData, { invoiceIds: [i1, x1] })).rejects.toThrow(/mteja mmoja/);
    await expect(as.query(api.customerBills.billData, { invoiceIds: [] })).rejects.toThrow(/angalau/);
  });
});

describe("bills across departments", () => {
  it("only a user with the permission can put Kitchen and Bar invoices of the same customer on one bill", async () => {
    const t = convexTest(schema, modules);
    const d = await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", { name: "Club", code: "C", isActive: true, createdByToken: "t", createdAt: "2026-01-01" });
      const bar = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "C-D1", isActive: true, createdAt: "x" });
      const jiko = await ctx.db.insert("branches", { tenantId, name: "Jiko", code: "C-D2", isActive: true, createdAt: "x" });
      const waiter = await ctx.db.insert("users", { name: "Hawa", username: "hawa", role: "waiter", tenantId, branchId: bar, isActive: true });
      const plain = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, branchId: bar, isActive: true });
      await ctx.db.insert("roles", { name: "waiter", displayName: "Waiter", permissions: ["sales.manage", "bills.all_departments"], isSystem: false } as any);
      const mk = async (branchId: any, no: string, total: number) => {
        const scope = { tenantId, branchId };
        const c = await ctx.db.insert("clients", { ...scope, code: "M5", name: "Meza 5", openingBalance: 0, creditPolicy: "allow", isActive: true });
        const p = await ctx.db.insert("products", { ...scope, itemCode: "I" + no, name: "Bidhaa " + no, sellingPrice: total, openingQty: 1, currentQty: 1, isActive: true } as any);
        const id = await ctx.db.insert("invoices", { ...scope, invoiceNo: no, invoiceDate: "2026-03-01", clientId: c, subtotal: total, discount: 0, taxAmount: 0, total, amountPaid: 0, outstanding: total, paymentStatus: "unpaid", status: "posted", createdBy: waiter });
        await ctx.db.insert("invoiceLines", { invoiceId: id, productId: p, qty: 1, qtyStr: "1", unitPrice: total, unitPriceStr: String(total), lineTotal: total, lineTotalStr: String(total), costAtSale: 0, discount: 0 });
        return { c, id };
      };
      return { waiter, plain, bar: await mk(bar, "BAR-1", 3000), jiko: await mk(jiko, "JIKO-1", 7000) };
    });
    const asWaiter = t.withIdentity({ subject: d.waiter, tokenIdentifier: "x|1" });
    const asPlain = t.withIdentity({ subject: d.plain, tokenIdentifier: "x|2" });

    expect((await asWaiter.query(api.customerBills.access, {})).allDepartments).toBe(true);
    const own = await asWaiter.query(api.customerBills.invoicesForClient, { clientId: d.bar.c });
    expect(own.map((i: any) => i.invoiceNo)).toEqual(["BAR-1"]);
    const both = await asWaiter.query(api.customerBills.invoicesForClient, { clientId: d.bar.c, allDepartments: true });
    expect(both.map((i: any) => i.department).sort()).toEqual(["Bar", "Jiko"]);
    const bill = await asWaiter.query(api.customerBills.billData, { invoiceIds: [d.bar.id, d.jiko.id] });
    expect(bill.totals.total).toBe(10000);
    expect(bill.department).toBe("Bar + Jiko");

    // no permission: sees only own department and cannot add the other one
    expect((await asPlain.query(api.customerBills.access, {})).allDepartments).toBe(false);
    expect((await asPlain.query(api.customerBills.invoicesForClient, { clientId: d.bar.c, allDepartments: true })).map((i: any) => i.invoiceNo)).toEqual(["BAR-1"]);
    await expect(asPlain.query(api.customerBills.billData, { invoiceIds: [d.bar.id, d.jiko.id] })).rejects.toThrow(/haipatikani/);
  });
});
