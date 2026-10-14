import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const a = await ctx.db.insert("tenants", { name: "Duka A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const b = await ctx.db.insert("tenants", { name: "Duka B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const admin = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const staffA = await ctx.db.insert("users", { name: "Mgr A", username: "mgra", role: "manager", tenantId: a, isActive: true });
    await ctx.db.insert("clients", { tenantId: a, code: "CA", name: "Client A", openingBalance: 0, creditPolicy: "allow", isActive: true });
    await ctx.db.insert("clients", { tenantId: b, code: "CB", name: "Client B", openingBalance: 0, creditPolicy: "allow", isActive: true });
    return { a, b, admin, staffA };
  });
  const asAdmin = t.withIdentity({ subject: ids.admin, tokenIdentifier: "x|1" });
  const asStaff = t.withIdentity({ subject: ids.staffA, tokenIdentifier: "x|2" });
  return { t, asAdmin, asStaff, ...ids };
}

describe("Super Admin business picker", () => {
  it("starts at the picker, then only sees the chosen business", async () => {
    const { asAdmin, a } = await setup();
    expect((await asAdmin.query(api.tenants.current, {}))?.needsPicker).toBe(true);
    expect((await asAdmin.query(api.tenants.listForPicker, {})).map((x) => x.name)).toEqual(["Duka A", "Duka B"]);
    await asAdmin.mutation(api.tenants.selectBusiness, { tenantId: a });
    const cur = await asAdmin.query(api.tenants.current, {});
    expect(cur?.needsPicker).toBe(false);
    expect(cur?.tenant?.name).toBe("Duka A");
    const clients = await asAdmin.query(api.clients.list, {});
    expect(clients.map((c) => c.name)).toEqual(["Client A"]);
    await asAdmin.mutation(api.tenants.exitBusiness, {});
    expect((await asAdmin.query(api.tenants.current, {}))?.needsPicker).toBe(true);
  });

  it("stopping a business blocks its users and returns the admin to the picker; resume restores access", async () => {
    const { asAdmin, asStaff, a } = await setup();
    await asAdmin.mutation(api.tenants.selectBusiness, { tenantId: a });
    await asAdmin.mutation(api.tenants.setActive, { tenantId: a, isActive: false });
    expect((await asAdmin.query(api.tenants.current, {}))?.needsPicker).toBe(true);
    expect((await asStaff.query(api.tenants.current, {}))?.suspended).toBe(true);
    await expect(asStaff.query(api.clients.list, {})).rejects.toThrow(/suspended/);
    await expect(asAdmin.mutation(api.tenants.selectBusiness, { tenantId: a })).rejects.toThrow(/imesimamishwa/);
    await asAdmin.mutation(api.tenants.setActive, { tenantId: a, isActive: true });
    expect((await asStaff.query(api.tenants.current, {}))?.suspended).toBe(false);
    expect(await asStaff.query(api.clients.list, {})).toHaveLength(1);
  });

  it("registers a new business and rejects non-admins", async () => {
    const { asAdmin, asStaff } = await setup();
    const r = await asAdmin.mutation(api.tenants.create, { name: "Duka C", code: "c" });
    expect(r.branchesCreated).toBe(0); // departments are optional
    await expect(asStaff.mutation(api.tenants.setActive, { tenantId: r.tenantId, isActive: false })).rejects.toThrow(/Super Admin/);
  });
});

describe("Departments (Bar / Lounge / Kitchen inside one business)", () => {
  it("creates departments with the business and keeps their figures separate", async () => {
    const { t, asAdmin } = await setup();
    const r = await asAdmin.mutation(api.tenants.create, { name: "Club X", code: "x", departments: ["Bar", "Lounge", "Jiko"] });
    expect(r.branchesCreated).toBe(3);
    await expect(asAdmin.mutation(api.tenants.create, { name: "Dup", code: "dup", departments: ["Bar", "bar"] })).rejects.toThrow(/yasijirudie/);
    await asAdmin.mutation(api.tenants.selectBusiness, { tenantId: r.tenantId });
    const cur = await asAdmin.query(api.tenants.current, {});
    expect(cur?.departments.map((d) => d.name)).toEqual(["Bar", "Lounge", "Jiko"]);
    // working without choosing a department is refused, so nothing lands "nowhere"
    await expect(asAdmin.mutation(api.clients.upsert, { code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true })).rejects.toThrow(/Chagua idara/);
    const [bar, lounge] = cur!.departments;
    await asAdmin.mutation(api.tenants.switchDepartment, { branchId: bar._id });
    await asAdmin.mutation(api.clients.upsert, { code: "C1", name: "Mteja wa Bar", openingBalance: 0, creditPolicy: "allow", isActive: true });
    await asAdmin.mutation(api.tenants.switchDepartment, { branchId: lounge._id });
    expect(await asAdmin.query(api.clients.list, {})).toHaveLength(0); // Lounge does not see Bar's customers
    await asAdmin.mutation(api.tenants.switchDepartment, {});
    expect(await asAdmin.query(api.clients.list, {})).toHaveLength(1); // all departments together
    void t;
  });

  it("a user tied to one department cannot switch", async () => {
    const { t, asAdmin } = await setup();
    const r = await asAdmin.mutation(api.tenants.create, { name: "Club Y", code: "y", departments: ["Bar", "Jiko"] });
    const { staff, bar, jiko } = await t.run(async (ctx) => {
      const [bar, jiko] = await ctx.db.query("branches").withIndex("by_tenant", (q) => q.eq("tenantId", r.tenantId)).collect();
      const staff = await ctx.db.insert("users", { name: "Hawa", username: "hawa", role: "cashier", tenantId: r.tenantId, branchId: bar._id, isActive: true });
      return { staff, bar: bar._id, jiko: jiko._id };
    });
    const asHawa = t.withIdentity({ subject: staff, tokenIdentifier: "x|9" });
    expect((await asHawa.query(api.tenants.current, {}))?.canSwitch).toBe(false);
    await expect(asHawa.mutation(api.tenants.switchDepartment, { branchId: jiko })).rejects.toThrow(/imefungwa/);
    void bar;
  });
});

describe("Department accounts and removal", () => {
  it("keeps each department's accounts separate and only removes empty departments", async () => {
    const { asAdmin } = await setup();
    const r = await asAdmin.mutation(api.tenants.create, { name: "Club Z", code: "z", departments: ["Bar", "Jiko"] });
    await asAdmin.mutation(api.tenants.selectBusiness, { tenantId: r.tenantId });
    const [bar, jiko] = (await asAdmin.query(api.tenants.current, {}))!.departments;
    await asAdmin.mutation(api.tenants.switchDepartment, { branchId: bar._id });
    await asAdmin.mutation(api.bills.create, { vendor: "TANESCO", category: "electricity", billDate: "2026-03-01", dueDate: "2026-03-15", amount: 50000 });
    await asAdmin.mutation(api.tenants.switchDepartment, { branchId: jiko._id });
    await asAdmin.mutation(api.bills.create, { vendor: "Gesi", category: "other", billDate: "2026-03-01", dueDate: "2026-03-15", amount: 20000 });
    const jikoTb = await asAdmin.query(api.accounting.trialBalance, {});
    expect(jikoTb.reduce((n: number, a) => n + a.debit, 0)).toBe(20000);
    await asAdmin.mutation(api.tenants.switchDepartment, { branchId: bar._id });
    const barTb = await asAdmin.query(api.accounting.trialBalance, {});
    expect(barTb.reduce((n: number, a) => n + a.debit, 0)).toBe(50000);
    await asAdmin.mutation(api.tenants.switchDepartment, {});
    const allTb = await asAdmin.query(api.accounting.trialBalance, {});
    expect(allTb.reduce((n: number, a) => n + a.debit, 0)).toBe(70000); // owner sees the combined figures
    await expect(asAdmin.mutation(api.tenants.removeDepartment, { branchId: bar._id })).rejects.toThrow(/ina rekodi/);
    const r2 = await asAdmin.mutation(api.tenants.create, { name: "Empty", code: "e", departments: ["Zamani"] });
    await asAdmin.mutation(api.tenants.exitBusiness, {});
    await asAdmin.mutation(api.tenants.selectBusiness, { tenantId: r2.tenantId });
    const [old] = (await asAdmin.query(api.tenants.current, {}))!.departments;
    await asAdmin.mutation(api.tenants.removeDepartment, { branchId: old._id });
    expect((await asAdmin.query(api.tenants.current, {}))!.departments).toHaveLength(0);
  });
});
