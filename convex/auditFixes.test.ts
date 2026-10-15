import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";
import { ALL_PERMISSION_KEYS } from "./permissions";

const date = new Date().toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "stock", "purchasing"] });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const barUser = await ctx.db.insert("users", { name: "Bar", username: "bar", role: "cashier", tenantId, isActive: true });
    const keeper = await ctx.db.insert("users", { name: "Keeper", username: "keeper", role: "storekeeper", tenantId, isActive: true });
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme", openingBalance: 0, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Sukari", openingQty: 0, currentQty: 0, sellingPrice: 1500, isActive: true });
    return { tenantId, mgr, barUser, keeper, supplierId, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asMgr: as(ids.mgr, 1), asBar: as(ids.barUser, 2), asKeeper: as(ids.keeper, 3) };
}

describe("audit fixes", () => {
  it("a user working in one department still sees the business-wide suppliers on the purchasing registers", async () => {
    const { t, tenantId, barUser, asBar, supplierId } = await setup();
    await t.run(async (ctx) => {
      const branchId = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "DK-D1", isActive: true, createdAt: new Date().toISOString() });
      await ctx.db.patch("users", barUser, { branchId });
    });
    const reg = await asBar.query(api.purchasing.purchasingRegisters, {});
    expect(reg.suppliers.map((s) => s._id)).toContain(supplierId);
  });

  it("the same supplier invoice number cannot be entered twice (on entry or on edit)", async () => {
    const { asMgr, supplierId, productId } = await setup();
    const first = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, supplierInvoiceNo: "A-1", lines: [{ productId, qty: 1, unitCost: 100 }] });
    await expect(asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, supplierInvoiceNo: " a-1 ", lines: [{ productId, qty: 1, unitCost: 100 }] })).rejects.toThrow(/tayari imetumika/);
    const second = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, supplierInvoiceNo: "A-2", lines: [{ productId, qty: 1, unitCost: 100 }] });
    await expect(asMgr.mutation(api.purchasingEdit.editPurchase, { purchaseId: second.purchaseId, supplierInvoiceNo: "A-1" })).rejects.toThrow(/tayari imetumika/);
    // Keeping its own number is fine.
    await asMgr.mutation(api.purchasingEdit.editPurchase, { purchaseId: first.purchaseId, supplierInvoiceNo: "A-1", notes: "sawa" });
  });

  it("a Manager role saved before the purchase switches existed still gets them", async () => {
    const { t, asMgr, mgr } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch("users", mgr, { role: "manager" });
      await ctx.db.insert("roles", { name: "manager", displayName: "Manager", permissions: ["system.manager", "sales.manage", "purchasing.manage"], isSystem: true });
    });
    expect(await asMgr.query(api.tenants.current, {})).toMatchObject({ canEditPurchase: true, canDeletePurchase: true, canVoidInvoice: true });
    // Once the role is saved again its own choice wins.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("roles").withIndex("by_name", (q) => q.eq("name", "manager")).first();
      await ctx.db.patch("roles", row!._id, { permissions: ["system.manager"], knownKeys: ALL_PERMISSION_KEYS });
    });
    expect(await asMgr.query(api.tenants.current, {})).toMatchObject({ isManager: true, canEditPurchase: false, canDeletePurchase: false });
  });

  it("a custom role with only purchasing.manage can receive purchases without being a manager", async () => {
    const { t, asKeeper, supplierId, productId } = await setup();
    await expect(asKeeper.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, lines: [{ productId, qty: 2, unitCost: 500 }] })).rejects.toThrow(/Forbidden/);
    await t.run(async (ctx) => { await ctx.db.insert("roles", { name: "storekeeper", displayName: "Store keeper", permissions: ["purchasing.manage"], isSystem: false }); });
    const r = await asKeeper.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, lines: [{ productId, qty: 2, unitCost: 500 }] });
    expect(r.total).toBe(1000);
  });

  it("the average cost ignores negative stock when new goods are received", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("products", productId, { currentQty: -5, weightedAvgCost: 900 }); });
    await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, lines: [{ productId, qty: 10, unitCost: 1000 }] });
    await t.run(async (ctx) => {
      const p = await ctx.db.get("products", productId);
      expect(p?.currentQty).toBe(5);
      expect(p?.weightedAvgCost).toBe(1000);
    });
  });

  it("a customer code cannot be changed to one that another customer of the same business already has", async () => {
    const { asMgr } = await setup();
    const base = { openingBalance: 0, creditPolicy: "allow", isActive: true };
    await asMgr.mutation(api.clients.upsert, { code: "C1", name: "Asha", ...base });
    const other = await asMgr.mutation(api.clients.upsert, { code: "C2", name: "Juma", ...base });
    await expect(asMgr.mutation(api.clients.upsert, { id: other, code: " C1 ", name: "Juma", ...base })).rejects.toThrow(/already exists/);
    await asMgr.mutation(api.clients.upsert, { id: other, code: "C2", name: "Juma M.", ...base });
  });
});

describe("changing / deleting stock is a permission given by the Super Admin", () => {
  const adjustArgs = (productId: Id<"products">) => ({ productId, newQty: 5, reason: "count", adjustmentDate: date });
  const editArgs = (id: Id<"products">) => ({ id, itemCode: "P1", name: "Sukari 2", sellingPrice: 1600, isActive: true });

  it("Administrator and Manager do NOT have it by default; new items can still be added", async () => {
    const { asMgr, productId } = await setup();
    await expect(asMgr.mutation(api.inventory.adjust, adjustArgs(productId))).rejects.toThrow(/stock.adjust/);
    await expect(asMgr.mutation(api.inventory.reconcileMovements, {})).rejects.toThrow(/stock.adjust/);
    await expect(asMgr.mutation(api.products.upsert, editArgs(productId))).rejects.toThrow(/stock.adjust/);
    await expect(asMgr.mutation(api.products.importBatch, { rows: [{ name: "Chai" }], dryRun: false, updateExisting: true })).rejects.toThrow(/ruhusa/);
    await asMgr.mutation(api.products.upsert, { itemCode: "P2", name: "Chai", sellingPrice: 500, isActive: true });
    const res = await asMgr.mutation(api.products.importBatch, { rows: [{ name: "Kahawa" }], dryRun: false, updateExisting: false });
    expect(res.created).toBe(1);
  });

  it("the owner wildcard does not include it either", async () => {
    const { t, tenantId, productId } = await setup();
    const owner = await t.run((ctx) => ctx.db.insert("users", { name: "Owner", username: "owner", role: "owner", tenantId, isActive: true }));
    const asOwner = t.withIdentity({ subject: owner, tokenIdentifier: "x|9" });
    await expect(asOwner.mutation(api.inventory.adjust, adjustArgs(productId))).rejects.toThrow(/stock.adjust/);
  });

  it("a cashier can be given it for one user, or through the role", async () => {
    const { t, asBar, barUser, productId } = await setup();
    await expect(asBar.mutation(api.inventory.adjust, adjustArgs(productId))).rejects.toThrow(/stock.adjust/);
    expect(await asBar.query(api.tenants.current, {})).toMatchObject({ canAdjustStock: false });

    await t.run(async (ctx) => { await ctx.db.patch("users", barUser, { extraPermissions: ["stock.adjust"] }); });
    expect(await asBar.query(api.tenants.current, {})).toMatchObject({ canAdjustStock: true });
    await asBar.mutation(api.inventory.adjust, adjustArgs(productId));
    await asBar.mutation(api.products.upsert, editArgs(productId));
    await t.run(async (ctx) => {
      expect((await ctx.db.get("products", productId))?.currentQty).toBe(5);
      await ctx.db.patch("users", barUser, { extraPermissions: undefined });
      await ctx.db.insert("roles", { name: "cashier", displayName: "Cashier", permissions: ["sales.manage", "stock.adjust"], isSystem: true });
    });
    await asBar.mutation(api.inventory.adjust, { ...adjustArgs(productId), newQty: 3 });
  });

  it("only a Super Admin can give it to a role; others are refused", async () => {
    const { t, tenantId, asBar, productId } = await setup();
    const rm = await t.run(async (ctx) => {
      await ctx.db.insert("roles", { name: "rolesmanager", displayName: "Roles", permissions: ["maintenance.roles"], isSystem: false });
      return await ctx.db.insert("users", { name: "RM", username: "rm", role: "rolesmanager", tenantId, isActive: true });
    });
    const boss = await t.run((ctx) => ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true }));
    const asRm = t.withIdentity({ subject: rm, tokenIdentifier: "x|7" });
    const asBoss = t.withIdentity({ subject: boss, tokenIdentifier: "x|8" });
    const role = { name: "cashier", displayName: "Cashier", permissions: ["sales.manage", "stock.adjust"] };
    await expect(asRm.mutation(api.maintenance.saveRole, role)).rejects.toThrow(/Super Admin/);
    await asBoss.mutation(api.maintenance.saveRole, role);
    await asBar.mutation(api.inventory.adjust, adjustArgs(productId));
  });
});
