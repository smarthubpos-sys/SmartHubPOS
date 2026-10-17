import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const mk = (n: string, c: string) => ctx.db.insert("tenants", { name: n, code: c, isActive: true, createdByToken: "t", createdAt: now });
    const T = await mk("Shop", "T"); const U = await mk("Other", "U");
    const branchA = await ctx.db.insert("branches", { tenantId: T, name: "Tawi A", code: "A", isActive: true, createdAt: now });
    const branchB = await ctx.db.insert("branches", { tenantId: T, name: "Tawi B", code: "B", isActive: true, createdAt: now });
    const user = (username: string, role: string, tenantId: typeof T, extra?: string[]) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, extraPermissions: extra });
    const mgr = await user("mgr", "manager", T, ["stock.adjust"]);
    const mgrNoAdj = await user("mgr2", "manager", T);
    const cashier = await user("cash", "cashier", T);
    const waiter = await user("waiter", "waiter", T);
    const other = await user("other", "manager", U, ["stock.adjust"]);
    const branchUserA = await ctx.db.insert("users", { name: "branchA", username: "branchA", role: "manager", tenantId: T, branchId: branchA, isActive: true, extraPermissions: ["stock.adjust"] });
    const branchUserB = await ctx.db.insert("users", { name: "branchB", username: "branchB", role: "manager", tenantId: T, branchId: branchB, isActive: true, extraPermissions: ["stock.adjust"] });
    const prod = (tenantId: typeof T, code: string) => ctx.db.insert("products", { tenantId, itemCode: code, name: `P${code}`, openingQty: 0, currentQty: 0, sellingPrice: 100, isActive: true });
    const p1 = await prod(T, "A1"); const pOther = await prod(U, "Z1");
    return { T, U, branchA, branchB, mgr, mgrNoAdj, cashier, waiter, other, branchUserA, branchUserB, p1, pOther };
  });
  const as = (id: typeof ids.mgr, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  const asMgr = as(ids.mgr, 1);
  const main = await asMgr.mutation(api.warehouses.create, { code: "MAIN", name: "Ghala Kuu", kind: "warehouse" });
  const shop = await asMgr.mutation(api.warehouses.create, { code: "DUKA", name: "Duka", kind: "shop" });
  const branchMainA = await asMgr.mutation(api.warehouses.create, { code: "BR-A", name: "Ghala Tawi A", kind: "warehouse", branchId: ids.branchA });
  const branchMainB = await asMgr.mutation(api.warehouses.create, { code: "BR-B", name: "Ghala Tawi B", kind: "warehouse", branchId: ids.branchB });
  return { t, asMgr, asNoAdj: as(ids.mgrNoAdj, 2), asCashier: as(ids.cashier, 3), asWaiter: as(ids.waiter, 4), asOther: as(ids.other, 5), asBranchA: as(ids.branchUserA, 6), asBranchB: as(ids.branchUserB, 7), main, shop, branchMainA, branchMainB, ...ids };
}

const qtyOf = async (asMgr: Awaited<ReturnType<typeof setup>>["asMgr"], warehouseId: string, productId: string) =>
  (await asMgr.query(api.warehouses.stockBalances, { warehouseId: warehouseId as never })).find((r) => String(r.productId) === productId)?.quantity ?? 0;

describe("warehouse permissions (enforced on the backend)", () => {
  it("cashier and waiter cannot touch Store/Ghala; stock.adjust is not implied by the manager role", async () => {
    const { asCashier, asWaiter, asNoAdj, main, p1 } = await setup();
    for (const as of [asCashier, asWaiter]) {
      await expect(as.query(api.warehouses.list, {})).rejects.toThrow(/Forbidden/);
      await expect(as.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 1, unitCost: 1 })).rejects.toThrow(/Forbidden/);
      await expect(as.mutation(api.warehouses.recordWastage, { warehouseId: main, productId: p1, quantity: 1, reason: "x" })).rejects.toThrow(/Forbidden/);
    }
    await expect(asNoAdj.mutation(api.warehouses.adjustUp, { warehouseId: main, productId: p1, quantity: 1, reason: "count" })).rejects.toThrow(/stock.adjust/);
  });

  it("another business cannot read or change this business's warehouses", async () => {
    const { asOther, asMgr, main, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 5, unitCost: 10 });
    expect(await asOther.query(api.warehouses.list, {})).toHaveLength(0);
    await expect(asOther.query(api.warehouses.stockBalances, { warehouseId: main })).rejects.toThrow(/Ghala halipo/);
    await expect(asOther.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 1, unitCost: 1 })).rejects.toThrow();
    expect((await asOther.query(api.warehouses.valuation, {})).total).toBe(0);
  });
});

describe("receiving, transfers and the ledger", () => {
  it("receive is idempotent by key and valued at weighted-average cost", async () => {
    const { asMgr, main, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { idempotencyKey: "r1", warehouseId: main, productId: p1, quantity: 10, unitCost: 100 });
    const dup = await asMgr.mutation(api.warehouses.receive, { idempotencyKey: "r1", warehouseId: main, productId: p1, quantity: 10, unitCost: 100 });
    expect(dup.duplicate).toBe(true);
    await asMgr.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 10, unitCost: 200 });
    expect(await qtyOf(asMgr, main, p1)).toBe(20);
    expect((await asMgr.query(api.warehouses.valuation, {})).total).toBe(3000); // 20 x 150
    expect(await asMgr.query(api.warehouses.reconcile, {})).toEqual([]);
  });

  it("full flow: pending -> sent -> received; double click creates one transfer and dispatch/receive apply once", async () => {
    const { asMgr, main, shop, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 10, unitCost: 100 });
    const a = await asMgr.mutation(api.warehouses.createTransfer, { idempotencyKey: "tr1", fromWarehouseId: main, toWarehouseId: shop, lines: [{ productId: p1, quantity: 4 }] });
    const b = await asMgr.mutation(api.warehouses.createTransfer, { idempotencyKey: "tr1", fromWarehouseId: main, toWarehouseId: shop, lines: [{ productId: p1, quantity: 4 }] });
    expect(b).toBe(a);
    expect(await asMgr.query(api.warehouses.transfers, {})).toHaveLength(1);
    expect(await qtyOf(asMgr, main, p1)).toBe(10); // pending moves nothing
    await asMgr.mutation(api.warehouses.dispatchTransfer, { transferId: a });
    await expect(asMgr.mutation(api.warehouses.dispatchTransfer, { transferId: a })).rejects.toThrow(/tayari/);
    expect(await qtyOf(asMgr, main, p1)).toBe(6);
    expect(await qtyOf(asMgr, shop, p1)).toBe(0); // in transit is NOT received
    const [tr] = await asMgr.query(api.warehouses.transfers, {});
    await asMgr.mutation(api.warehouses.receiveTransfer, { transferId: a, lines: [{ lineId: tr.lines[0]._id, receivedQuantity: 4 }] });
    await expect(asMgr.mutation(api.warehouses.receiveTransfer, { transferId: a, lines: [{ lineId: tr.lines[0]._id, receivedQuantity: 4 }] })).rejects.toThrow(/umetumwa/);
    expect(await qtyOf(asMgr, shop, p1)).toBe(4);
    expect(await asMgr.query(api.warehouses.reconcile, {})).toEqual([]);
  });

  it("shortage/damage on receipt needs a reason, is written off in the ledger and shows in the loss report", async () => {
    const { asMgr, main, shop, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 10, unitCost: 100 });
    const id = await asMgr.mutation(api.warehouses.createTransfer, { fromWarehouseId: main, toWarehouseId: shop, lines: [{ productId: p1, quantity: 10 }] });
    await asMgr.mutation(api.warehouses.dispatchTransfer, { transferId: id });
    const [tr] = await asMgr.query(api.warehouses.transfers, {}); const lineId = tr.lines[0]._id;
    await expect(asMgr.mutation(api.warehouses.receiveTransfer, { transferId: id, lines: [{ lineId, receivedQuantity: 8 }] })).rejects.toThrow(/sababu/);
    await expect(asMgr.mutation(api.warehouses.receiveTransfer, { transferId: id, lines: [{ lineId, receivedQuantity: 11 }] })).rejects.toThrow(/kuzidi/);
    await asMgr.mutation(api.warehouses.receiveTransfer, { transferId: id, lines: [{ lineId, receivedQuantity: 8, damagedQuantity: 1, differenceNote: "1 imevunjika, 1 haipo" }] });
    expect(await qtyOf(asMgr, shop, p1)).toBe(8);
    const rep = await asMgr.query(api.warehouses.lossReport, {});
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0].lostQuantity).toBe(2);
    expect(rep.totalValue).toBe(200);
    expect(await asMgr.query(api.warehouses.reconcile, {})).toEqual([]);
  });

  it("cancel a pending transfer; reject an in-transit one and the stock returns to the source", async () => {
    const { asMgr, main, shop, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 10, unitCost: 100 });
    const c = await asMgr.mutation(api.warehouses.createTransfer, { fromWarehouseId: main, toWarehouseId: shop, lines: [{ productId: p1, quantity: 3 }] });
    await expect(asMgr.mutation(api.warehouses.cancelTransfer, { transferId: c, reason: " " })).rejects.toThrow(/sababu/);
    await asMgr.mutation(api.warehouses.cancelTransfer, { transferId: c, reason: "kosa" });
    await expect(asMgr.mutation(api.warehouses.dispatchTransfer, { transferId: c })).rejects.toThrow(/tayari/);
    const r = await asMgr.mutation(api.warehouses.createTransfer, { fromWarehouseId: main, toWarehouseId: shop, lines: [{ productId: p1, quantity: 3 }] });
    await asMgr.mutation(api.warehouses.dispatchTransfer, { transferId: r });
    expect(await qtyOf(asMgr, main, p1)).toBe(7);
    await asMgr.mutation(api.warehouses.rejectTransfer, { transferId: r, reason: "haikuagizwa" });
    expect(await qtyOf(asMgr, main, p1)).toBe(10);
    await expect(asMgr.mutation(api.warehouses.rejectTransfer, { transferId: r, reason: "tena" })).rejects.toThrow(/umetumwa/);
    expect(await asMgr.query(api.warehouses.reconcile, {})).toEqual([]);
  });

  it("negative stock is blocked for transfers, wastage and adjustments", async () => {
    const { asMgr, main, shop, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 2, unitCost: 100 });
    await expect(asMgr.mutation(api.warehouses.createTransfer, { fromWarehouseId: main, toWarehouseId: shop, lines: [{ productId: p1, quantity: 3 }] })).rejects.toThrow(/haitoshi/);
    await expect(asMgr.mutation(api.warehouses.recordWastage, { warehouseId: main, productId: p1, quantity: 3, reason: "x" })).rejects.toThrow(/haitoshi/);
    await expect(asMgr.mutation(api.warehouses.adjustDown, { warehouseId: main, productId: p1, quantity: 3, reason: "x" })).rejects.toThrow(/haitoshi/);
    expect(await qtyOf(asMgr, main, p1)).toBe(2);
  });

  it("wastage and adjustments need a reason, are idempotent and always leave a ledger entry", async () => {
    const { asMgr, main, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: main, productId: p1, quantity: 10, unitCost: 100 });
    await expect(asMgr.mutation(api.warehouses.recordWastage, { warehouseId: main, productId: p1, quantity: 1, reason: "" })).rejects.toThrow(/sababu/);
    await asMgr.mutation(api.warehouses.recordWastage, { idempotencyKey: "w1", warehouseId: main, productId: p1, quantity: 2, reason: "imeharibika" });
    expect((await asMgr.mutation(api.warehouses.recordWastage, { idempotencyKey: "w1", warehouseId: main, productId: p1, quantity: 2, reason: "imeharibika" })).duplicate).toBe(true);
    await asMgr.mutation(api.warehouses.adjustUp, { warehouseId: main, productId: p1, quantity: 1, reason: "hesabu" });
    expect(await qtyOf(asMgr, main, p1)).toBe(9);
    const mv = await asMgr.query(api.warehouses.movements, { warehouseId: main });
    expect(mv.rows.map((m) => m.movementType).sort()).toEqual(["adjust_in", "receive", "wastage"]);
    expect(await asMgr.query(api.warehouses.reconcile, {})).toEqual([]);
  });
});

describe("warehouse branch isolation", () => {
  it("limits warehouse reads, balances, movements and valuation to the selected branch", async () => {
    const { asMgr, asBranchA, branchA, branchMainA, branchMainB, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: branchMainA, productId: p1, quantity: 5, unitCost: 10 });
    await asMgr.mutation(api.warehouses.receive, { warehouseId: branchMainB, productId: p1, quantity: 9, unitCost: 10 });

    const warehouses = await asBranchA.query(api.warehouses.list, {});
    expect(warehouses.map(w => String(w._id))).toEqual([String(branchMainA)]);
    expect((await asBranchA.query(api.warehouses.stockBalances, {})).map(r => String(r.warehouseId))).toEqual([String(branchMainA)]);
    expect((await asBranchA.query(api.warehouses.valuation, {})).total).toBe(50);
    const movements = (await asBranchA.query(api.warehouses.movements, {})).rows;
    expect(movements).toHaveLength(1);
    expect(movements.every(m => m.branchId === branchA)).toBe(true);
  });

  it("blocks direct reads and stock changes against another branch", async () => {
    const { asMgr, asBranchA, branchMainA, branchMainB, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: branchMainA, productId: p1, quantity: 5, unitCost: 10 });
    await asMgr.mutation(api.warehouses.receive, { warehouseId: branchMainB, productId: p1, quantity: 9, unitCost: 10 });

    await expect(asBranchA.query(api.warehouses.stockBalances, { warehouseId: branchMainB })).rejects.toThrow(/tawi/);
    await expect(asBranchA.mutation(api.warehouses.receive, { warehouseId: branchMainB, productId: p1, quantity: 1, unitCost: 10 })).rejects.toThrow(/tawi/);
    await expect(asBranchA.mutation(api.warehouses.recordWastage, { warehouseId: branchMainB, productId: p1, quantity: 1, reason: "test" })).rejects.toThrow(/tawi/);
    expect((await asMgr.query(api.warehouses.stockBalances, { warehouseId: branchMainB })).find(r => String(r.productId) === String(p1))?.quantity).toBe(9);
  });

  it("restricts transfer dispatch to the source branch and receipt to the destination branch", async () => {
    const { asMgr, asBranchA, asBranchB, branchMainA, branchMainB, p1 } = await setup();
    await asMgr.mutation(api.warehouses.receive, { warehouseId: branchMainA, productId: p1, quantity: 6, unitCost: 10 });
    const transferId = await asMgr.mutation(api.warehouses.createTransfer, {
      fromWarehouseId: branchMainA,
      toWarehouseId: branchMainB,
      lines: [{ productId: p1, quantity: 3 }],
    });

    await expect(asBranchB.mutation(api.warehouses.dispatchTransfer, { transferId })).rejects.toThrow(/tawi/);
    await asMgr.mutation(api.warehouses.dispatchTransfer, { transferId });
    const [transfer] = await asMgr.query(api.warehouses.transfers, {});
    const lineId = transfer.lines.find(line => line.transferId === transferId)?._id ?? transfer.lines[0]._id;

    await expect(asBranchA.mutation(api.warehouses.receiveTransfer, {
      transferId,
      lines: [{ lineId, receivedQuantity: 3 }],
    })).rejects.toThrow(/tawi/);
    await asBranchB.mutation(api.warehouses.receiveTransfer, {
      transferId,
      lines: [{ lineId, receivedQuantity: 3 }],
    });
    expect(await qtyOf(asBranchB, branchMainB, p1)).toBe(3);
  });

});
