import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";
import type { Id } from "./_generated/dataModel";

/** When a person with the right to edit/cancel cannot find an invoice, the screen must say WHY (department, no department, staff mode). */
const now = new Date().toISOString();
const DAY = now.slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenant = await ctx.db.insert("tenants", { name: "Shop", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const other = await ctx.db.insert("tenants", { name: "Other", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const bar = await ctx.db.insert("branches", { tenantId: tenant, name: "Bar", code: "BAR", isActive: true, createdAt: now });
    const kit = await ctx.db.insert("branches", { tenantId: tenant, name: "Kitchen", code: "KIT", isActive: true, createdAt: now });
    const mk = (tenantId: Id<"tenants">, username: string, role: string, extra: Record<string, unknown> = {}) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    const edit = ["sales.edit", "sales.void"];
    const barCash = await mk(tenant, "barcash", "cashier", { branchId: bar, extraPermissions: edit });
    const multi = await mk(tenant, "multi", "cashier", { branchId: bar, branchIds: [bar, kit], extraPermissions: edit });
    const mine = await mk(tenant, "mine", "cashier", { branchId: bar, ownDataOnly: true, extraPermissions: edit });
    const kitMgr = await mk(tenant, "kitmgr", "manager", { branchId: kit });
    const foreignMgr = await mk(other, "foreign", "manager");
    const mkClient = (tenantId: Id<"tenants">, code: string, branchId?: Id<"branches">) => ctx.db.insert("clients", { tenantId, ...(branchId ? { branchId } : {}), code, name: code, openingBalance: 0, creditPolicy: "allow", isActive: true } as never);
    const mkProduct = (tenantId: Id<"tenants">, itemCode: string, branchId?: Id<"branches">) => ctx.db.insert("products", { tenantId, ...(branchId ? { branchId } : {}), itemCode, name: itemCode, openingQty: 100, currentQty: 100, sellingPrice: 100, isActive: true });
    return { tenant, other, bar, kit, barCash, multi, mine, kitMgr, foreignMgr,
      clientBar: await mkClient(tenant, "CB", bar), clientKit: await mkClient(tenant, "CK", kit), clientOther: await mkClient(other, "CO"),
      pBar: await mkProduct(tenant, "PB", bar), pKit: await mkProduct(tenant, "PK", kit), pOther: await mkProduct(other, "PO") };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  const make = (u: Id<"users">, clientId: Id<"clients">, productId: Id<"products">) => as(u).mutation(api.sales.createInvoice, { clientId, invoiceDate: DAY, lines: [{ productId, qty: 1, unitPrice: 100 }] });
  return { t, as, make, ...ids };
}

describe("why an invoice was not found", () => {
  it("says it belongs to another department, and whether the person can switch to it", async () => {
    const s = await setup();
    const kitchen = await s.make(s.kitMgr, s.clientKit, s.pKit);
    const single = await s.as(s.barCash).query(api.sales.invoiceSearchHint, { invoiceNo: "1" });
    expect(single).toMatchObject({ reason: "other_department", invoiceNo: kitchen.invoiceNo, department: "Kitchen", myDepartment: "Bar", canSwitch: false });
    const multi = await s.as(s.multi).query(api.sales.invoiceSearchHint, { invoiceNo: kitchen.invoiceNo });
    expect(multi).toMatchObject({ reason: "other_department", department: "Kitchen", canSwitch: true });
  });

  it("says an old invoice with no department is invisible to a one-department account", async () => {
    const s = await setup();
    const inv = await s.make(s.barCash, s.clientBar, s.pBar);
    await s.t.run((ctx) => ctx.db.patch("invoices", inv.invoiceId, { branchId: undefined }));
    expect(await s.as(s.barCash).query(api.sales.searchInvoices, { invoiceNo: "1" })).toHaveLength(0);
    expect(await s.as(s.barCash).query(api.sales.invoiceSearchHint, { invoiceNo: "1" })).toMatchObject({ reason: "no_department" });
  });

  it("says staff mode shows only the person's own invoices", async () => {
    const s = await setup();
    await s.make(s.barCash, s.clientBar, s.pBar); // written by another cashier of the same department
    expect(await s.as(s.mine).query(api.sales.searchInvoices, { invoiceNo: "1" })).toHaveLength(0);
    expect(await s.as(s.mine).query(api.sales.invoiceSearchHint, { invoiceNo: "1" })).toMatchObject({ reason: "own_only" });
  });

  it("has nothing to say when the invoice is visible, does not exist, or belongs to another business", async () => {
    const s = await setup();
    await s.make(s.barCash, s.clientBar, s.pBar);
    await s.make(s.foreignMgr, s.clientOther, s.pOther);
    expect(await s.as(s.barCash).query(api.sales.invoiceSearchHint, { invoiceNo: "1" })).toBeNull(); // visible
    expect(await s.as(s.barCash).query(api.sales.invoiceSearchHint, { invoiceNo: "99" })).toBeNull(); // does not exist
    // the foreign business' invoice has number 1 in ITS numbering; nothing about it may leak across businesses
    expect(await s.as(s.foreignMgr).query(api.sales.invoiceSearchHint, { invoiceNo: "1" })).toBeNull();
    expect(await s.as(s.barCash).query(api.sales.invoiceSearchHint, { invoiceNo: "" })).toBeNull();
  });
});
