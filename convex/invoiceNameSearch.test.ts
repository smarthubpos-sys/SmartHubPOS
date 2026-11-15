import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

/** Invoice Finder, search by customer name: a regular customer with many invoices, and the words typed in any order. */
async function setup() {
  const t = convexTest(schema, modules);
  const now = new Date().toISOString();
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const owner = await ctx.db.insert("users", { name: "Owner", username: "owner", role: "manager", tenantId, isActive: true });
    const mkClient = (code: string, name: string) => ctx.db.insert("clients", { tenantId, code, name, openingBalance: 0, creditPolicy: "allow", isActive: true });
    const mama = await mkClient("C1", "Mama Neema Joseph");
    const baba = await mkClient("C2", "Baba Asha");
    const mkInvoice = (n: number, clientId: typeof mama, day: string) => ctx.db.insert("invoices", {
      tenantId, invoiceNo: `INV-${String(n).padStart(5, "0")}`, invoiceDate: day, clientId, subtotal: 1000, discount: 0, taxAmount: 0, total: 1000,
      amountPaid: 0, outstanding: 1000, paymentStatus: "unpaid", status: "posted", createdBy: owner,
    });
    for (let i = 1; i <= 13; i++) await mkInvoice(i, mama, `2026-10-${String(i).padStart(2, "0")}`); // 13 invoices: more than the 10 that used to be shown
    await mkInvoice(14, baba, "2026-10-20");
    return { tenantId, owner };
  });
  return { t, ...ids, asOwner: t.withIdentity({ subject: ids.owner, tokenIdentifier: "x|owner" }) };
}

describe("Invoice Finder: search by customer name", () => {
  it("finds ALL the invoices of a regular customer (not only the latest 10), newest first", async () => {
    const { asOwner } = await setup();
    const r = await asOwner.query(api.sales.searchInvoices, { invoiceNo: "neema" });
    expect(r).toHaveLength(13);
    expect(r[0].invoiceNo).toBe("INV-00013"); // newest first
    expect(r.every((x) => x.clientName === "Mama Neema Joseph")).toBe(true);
  });

  it("the words can be typed in any order and a part of the name is enough", async () => {
    const { asOwner } = await setup();
    expect(await asOwner.query(api.sales.searchInvoices, { invoiceNo: "joseph mama" })).toHaveLength(13);
    const asha = await asOwner.query(api.sales.searchInvoices, { invoiceNo: "asha baba" });
    expect(asha.map((x) => x.invoiceNo)).toEqual(["INV-00014"]);
    expect(await asOwner.query(api.sales.searchInvoices, { invoiceNo: "nobody here" })).toHaveLength(0);
  });

  it("a customer with more than 1,000 invoices: ALL of them are listed", async () => {
    const { t, tenantId, owner, asOwner } = await setup();
    await t.run(async (ctx) => {
      const big = await ctx.db.insert("clients", { tenantId, code: "C9", name: "Mzee Kubwa Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
      for (let i = 1; i <= 1050; i++) {
        await ctx.db.insert("invoices", { tenantId, invoiceNo: `INV-9${String(i).padStart(5, "0")}`, invoiceDate: "2026-09-01", clientId: big, subtotal: 100, discount: 0, taxAmount: 0, total: 100, amountPaid: 0, outstanding: 100, paymentStatus: "unpaid", status: "posted", createdBy: owner });
      }
    });
    const r = await asOwner.query(api.sales.searchInvoices, { invoiceNo: "kubwa" });
    expect(r).toHaveLength(1050);
    expect(new Set(r.map((x) => x.invoiceNo)).size).toBe(1050);
  }, 60000);
});
