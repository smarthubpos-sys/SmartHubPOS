import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const date = new Date().toISOString().slice(0, 10);

/**
 * Business T has two departments (Bar, Kitchen). Businesses U and V have none.
 * adminBar is tied to Bar; adminAll works across departments; cashAll is an OLD cashier left on "Zote".
 */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const mkTenant = (name: string, code: string) => ctx.db.insert("tenants", { name, code, isActive: true, createdByToken: "t", createdAt: now });
    const T = await mkTenant("Hotel", "H"); const U = await mkTenant("Duka U", "U"); const V = await mkTenant("Duka V", "V");
    const bar = await ctx.db.insert("branches", { tenantId: T, name: "Bar", code: "BAR", isActive: true, createdAt: now });
    const kitchen = await ctx.db.insert("branches", { tenantId: T, name: "Kitchen", code: "KIT", isActive: true, createdAt: now });
    const lounge = await ctx.db.insert("branches", { tenantId: T, name: "Lounge", code: "LNG", isActive: true, createdAt: now });
    const user = (username: string, role: string, tenantId: Id<"tenants">, branchId?: Id<"branches">) => ctx.db.insert("users", { name: username, username, role, tenantId, branchId, isActive: true });
    const adminBar = await user("adminbar", "admin", T, bar);
    const adminAll = await user("adminall", "admin", T);
    const cashBar = await user("cashbar", "cashier", T, bar);
    const cashKitchen = await user("cashkitchen", "cashier", T, kitchen);
    const cashAll = await user("cashall", "cashier", T);
    const adminU = await user("adminu", "admin", U); const cashU = await user("cashu", "cashier", U);
    const adminV = await user("adminv", "admin", V);
    const acct = (tenantId: Id<"tenants">, code: string, type: string) => ctx.db.insert("accounts", { tenantId, code, name: `A${code}`, type, balance: 0, isActive: true, isSystem: false });
    const accU = [await acct(U, "1000", "asset"), await acct(U, "4000", "revenue")];
    const accV = [await acct(V, "1000", "asset"), await acct(V, "4000", "revenue")];
    const clientT = await ctx.db.insert("clients", { tenantId: T, branchId: bar, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const inv = (no: string, branchId: Id<"branches">, by: Id<"users">) => ctx.db.insert("invoices", { tenantId: T, branchId, invoiceNo: no, invoiceDate: date, clientId: clientT, subtotal: 100, discount: 0, taxAmount: 0, total: 100, amountPaid: 0, outstanding: 100, paymentStatus: "unpaid", status: "posted", createdBy: by, salespersonId: by });
    await inv("BAR-1", bar, adminBar); await inv("KIT-1", kitchen, adminAll);
    return { T, U, V, bar, kitchen, lounge, adminBar, adminAll, cashBar, cashKitchen, cashAll, adminU, cashU, adminV, accU, accV };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asBar: as(ids.adminBar, 1), asAll: as(ids.adminAll, 2), asU: as(ids.adminU, 3), asV: as(ids.adminV, 4) };
}

describe("a user tied to one department stays in it", () => {
  it("cannot free himself or move to another department by editing his own account", async () => {
    const { asBar, adminBar, kitchen, bar } = await setup();
    await expect(asBar.mutation(api.maintenance.updateUser, { userId: adminBar, clearBranch: true })).rejects.toThrow(/idara ya akaunti yako/);
    await expect(asBar.mutation(api.maintenance.updateUser, { userId: adminBar, branchId: kitchen })).rejects.toThrow(/idara ya akaunti yako/);
    // saving the form with the SAME department (what the screen sends) is fine
    expect(await asBar.mutation(api.maintenance.updateUser, { userId: adminBar, name: "Bar Boss", branchId: bar, clearBranch: false })).toBe(true);
  });

  it("manages only the users of his own department, and sees only them", async () => {
    const { asBar, cashBar, cashKitchen, kitchen } = await setup();
    await expect(asBar.mutation(api.maintenance.updateUser, { userId: cashKitchen, name: "X" })).rejects.toThrow(/idara moja/);
    await expect(asBar.mutation(api.maintenance.updateUser, { userId: cashBar, branchId: kitchen })).rejects.toThrow(/idara yako tu/);
    expect((await asBar.query(api.maintenance.listUsers, {})).map((u) => u.username).sort()).toEqual(["adminbar", "cashbar"]);
    await expect(asBar.query(internal.maintenance.authorizeUserAdmin, { targetUserId: cashKitchen })).rejects.toThrow(/idara moja/);
  });
});

describe("a business with departments does not leave staff on \"Zote\"", () => {
  it("cashier/viewer must have a department; managers may stay without one", async () => {
    const { asAll, cashBar } = await setup();
    await expect(asAll.mutation(api.maintenance.updateUser, { userId: cashBar, role: "cashier", clearBranch: true })).rejects.toThrow(/Biashara hii ina idara/);
    expect(await asAll.mutation(api.maintenance.updateUser, { userId: cashBar, role: "manager", clearBranch: true })).toBe(true);
  });

  it("a business without departments is unaffected, and password reset of an old floating user is not blocked", async () => {
    const { asU, asAll, cashU, cashAll } = await setup();
    expect(await asU.mutation(api.maintenance.updateUser, { userId: cashU, role: "cashier", clearBranch: true })).toBe(true);
    const r = await asAll.query(internal.maintenance.authorizeUserAdmin, { targetUserId: cashAll }).then(() => "ok", (e) => String(e));
    expect(r).not.toMatch(/Biashara hii ina idara/);
  });
});

describe("codes are unique inside a business, not across all businesses", () => {
  it("two businesses can use the same journal reference and employee code", async () => {
    const { asU, asV, accU, accV } = await setup();
    const post = (c: typeof asU, [a, b]: Id<"accounts">[]) => c.mutation(api.accounting.postJournal, { entryDate: date, reference: "J-1", description: "Test", lines: [{ accountId: a, debit: 50, credit: 0 }, { accountId: b, debit: 0, credit: 50 }] });
    await post(asU, accU); await post(asV, accV);
    await expect(post(asU, accU)).rejects.toThrow(/imeshatumika/);
    const emp = (c: typeof asU) => c.mutation(api.payroll.createEmployee, { employeeCode: "EMP-1", name: "Asha", startDate: date, basicSalary: 1000, salaryType: "monthly" });
    await emp(asU); await emp(asV);
    await expect(emp(asU)).rejects.toThrow(/imeshatumika/);
  });
});

describe("reports read only the chosen department", () => {
  it("sales registers of a department user list only that department's invoices", async () => {
    const { asBar, asAll } = await setup();
    expect((await asBar.query(api.sales.salesRegisters, {})).invoices.map((i) => i.invoiceNo)).toEqual(["BAR-1"]);
    expect((await asAll.query(api.sales.salesRegisters, {})).invoices.map((i) => i.invoiceNo).sort()).toEqual(["BAR-1", "KIT-1"]);
  });

  it("a saved period report must be in a scope the user may report on", async () => {
    const { asBar, asAll, bar, kitchen } = await setup();
    const sections = (bk: string) => [{ bk, name: "x", rows: [] }];
    const base = { period: "day", startDate: date, endDate: date, title: "T", scopeLabel: "x" };
    await expect(asBar.mutation(api.periodReport.save, { ...base, scope: "all", sections: sections(String(bar)) })).rejects.toThrow(/hairuhusiwi/);
    await expect(asBar.mutation(api.periodReport.save, { ...base, scope: String(kitchen), sections: sections(String(kitchen)) })).rejects.toThrow(/hairuhusiwi/);
    await asBar.mutation(api.periodReport.save, { ...base, scope: String(bar), sections: sections(String(bar)) });
    await asAll.mutation(api.periodReport.save, { ...base, scope: "all", sections: sections(String(kitchen)) });
  });
});

describe("notifications can always be opened", () => {
  it("an alert for a module the business does not have is not shown", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = new Date().toISOString();
      const small = await ctx.db.insert("tenants", { name: "Basic", code: "B", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "bills"] });
      const full = await ctx.db.insert("tenants", { name: "Full", code: "F", isActive: true, createdByToken: "t", createdAt: now });
      const mk = async (tenantId: Id<"tenants">, username: string) => {
        const user = await ctx.db.insert("users", { name: username, username, role: "admin", tenantId, isActive: true });
        await ctx.db.insert("bills", { tenantId, billNumber: "B1", vendor: "TANESCO", category: "electricity", billDate: "2020-01-01", dueDate: "2020-01-10", amount: 100, paidAmount: 0, status: "unpaid", createdBy: user });
        return user;
      };
      return { a: await mk(small, "small"), b: await mk(full, "full") };
    });
    const feed = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` }).query(api.notifications.feed, { today: date });
    expect((await feed(ids.a, 1)).items.some((i) => i.code === "bill_overdue")).toBe(false); // links to /accounts/expenses: module not available here
    expect((await feed(ids.b, 2)).items.some((i) => i.code === "bill_overdue")).toBe(true);
  });
});

describe("billboards", () => {
  it("the Super Admin can edit a banner, and viewers' clicks are counted", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = new Date().toISOString();
      const tenant = await ctx.db.insert("tenants", { name: "Duka", code: "D", isActive: true, createdByToken: "t", createdAt: now });
      const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
      const viewer = await ctx.db.insert("users", { name: "V", username: "v", role: "cashier", tenantId: tenant, isActive: true });
      return { boss, viewer };
    });
    const asBoss = t.withIdentity({ subject: ids.boss, tokenIdentifier: "x|1" });
    const asViewer = t.withIdentity({ subject: ids.viewer, tokenIdentifier: "x|2" });
    const id = await asBoss.mutation(api.announcements.create, { kind: "banner", title: "Punguzo", body: "Leo", linkUrl: "https://example.com/a", imageUrl: "https://example.com/a.png" });
    await asBoss.mutation(api.announcements.update, { id, kind: "banner", title: "Punguzo kubwa", body: "Leo tu", theme: "red" });
    const [b] = await asViewer.query(api.announcements.banners, {});
    expect(b.title).toBe("Punguzo kubwa");
    expect(b.linkUrl).toBeUndefined(); // an emptied link is really removed
    await expect(asBoss.mutation(api.announcements.update, { id, kind: "banner", title: "X", body: "", linkUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(asViewer.mutation(api.announcements.update, { id, kind: "banner", title: "X", body: "" })).rejects.toThrow();
    expect(await asViewer.mutation(api.announcements.trackClick, { id })).toBe(true);
    expect(await asViewer.mutation(api.announcements.trackClick, { id })).toBe(true);
    expect((await asBoss.query(api.announcements.list, {})).find((r) => r._id === id)?.clicks).toBe(2);
  });
});

describe("one business can have several admins / users of the same role", () => {
  it("username status: free names pass, taken names get free suggestions, half-created accounts are reusable", async () => {
    const { t, T } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("users", { username: "ghost" }); }); // login created, setup never finished
    // "adminu" belongs to business U; business T asks for it too
    const taken = await t.query(internal.maintenance.usernameStatus, { username: "adminu", tenantId: T });
    expect(taken.taken).toBe(true);
    expect(taken.suggestions[0]).toBe("adminu.h");
    expect(taken.suggestions.every((s) => s !== "adminu")).toBe(true);
    expect((await t.query(internal.maintenance.usernameStatus, { username: "newadmin", tenantId: T })).taken).toBe(false);
    const orphan = await t.query(internal.maintenance.usernameStatus, { username: "ghost", tenantId: T });
    expect(orphan.taken).toBe(false);
    expect(orphan.orphanId).toBeDefined();
  });

  it("a second admin can be set up in the same business (role is not limited to one person)", async () => {
    const { asAll, cashAll } = await setup();
    expect(await asAll.mutation(api.maintenance.updateUser, { userId: cashAll, role: "admin" })).toBe(true);
    expect((await asAll.query(api.maintenance.listUsers, {})).filter((u) => u.role === "admin")).toHaveLength(3);
  });
});

describe("a user can be given several departments (a waiter selling in Bar and Kitchen)", () => {
  it("ticking two departments lets him switch only between them, and he sees one department at a time", async () => {
    const { t, asAll, cashBar, bar, kitchen, lounge } = await setup();
    expect(await asAll.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [bar, kitchen], allDepartments: false })).toBe(true);
    const doc = await t.run(async (ctx) => await ctx.db.get("users", cashBar));
    expect(doc?.branchIds).toHaveLength(2);
    expect(doc?.branchId).toBe(bar); // starts in the first ticked department
    expect(doc?.branchPicked).toBe(true);
    // Least privilege: a cashier has no report access by default, so the cashier ROLE is given sales.reports.view for this test
    // (the per-user grant list deliberately does not include report permissions).
    await t.run(async (ctx) => { await ctx.db.insert("roles", { name: "cashier", displayName: "Cashier", permissions: ["sales.view", "sales.manage", "sales.print", "sales.reports.view"], isSystem: true }); });
    const asWaiter = t.withIdentity({ subject: cashBar, tokenIdentifier: "x|9" });
    const cur = await asWaiter.query(api.tenants.current, {});
    expect(cur?.departments.map((d) => d.name).sort()).toEqual(["Bar", "Kitchen"]); // Lounge is not offered
    expect(cur?.canSwitch).toBe(true);
    expect(cur?.canPickAll).toBe(false);
    expect((await asWaiter.query(api.sales.salesRegisters, {})).invoices.map((i) => i.invoiceNo)).toEqual(["BAR-1"]);
    await asWaiter.mutation(api.tenants.switchDepartment, { branchId: kitchen });
    expect((await asWaiter.query(api.sales.salesRegisters, {})).invoices.map((i) => i.invoiceNo)).toEqual(["KIT-1"]);
    await expect(asWaiter.mutation(api.tenants.switchDepartment, { branchId: lounge })).rejects.toThrow(/Huna ruhusa/);
    await expect(asWaiter.mutation(api.tenants.switchDepartment, {})).rejects.toThrow(/Huna ruhusa/); // no combined view
  });

  it("one ticked department ties him to it; \"all departments\" is an explicit grant", async () => {
    const { t, asAll, cashAll, cashBar, bar } = await setup();
    await asAll.mutation(api.maintenance.updateUser, { userId: cashAll, branchIds: [bar], allDepartments: false });
    const tied = await t.run(async (ctx) => await ctx.db.get("users", cashAll));
    expect(tied?.branchId).toBe(bar);
    expect(tied?.branchIds).toBeUndefined();
    expect(tied?.branchPicked).toBe(false);
    // nothing ticked and no explicit grant: refused for staff in a business with departments
    await expect(asAll.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [], allDepartments: false })).rejects.toThrow(/Biashara hii ina idara/);
    await asAll.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [], allDepartments: true });
    const all = await t.run(async (ctx) => await ctx.db.get("users", cashBar));
    expect(all?.allDepartments).toBe(true);
    expect(all?.branchId).toBeUndefined();
  });

  it("a department-limited admin cannot hand out other departments or \"all departments\"", async () => {
    const { asBar, cashBar, bar, kitchen } = await setup();
    await expect(asBar.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [bar, kitchen], allDepartments: false })).rejects.toThrow(/idara yako tu/);
    await expect(asBar.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [], allDepartments: true })).rejects.toThrow(/idara yako tu/);
    expect(await asBar.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [bar], allDepartments: false })).toBe(true);
  });

  it("refuses a department that belongs to another business", async () => {
    const { t, asAll, cashBar, U } = await setup();
    // the other business gets a department only inside THIS test, so the "business without departments" tests stay true
    const branchU = await t.run(async (ctx) => await ctx.db.insert("branches", { tenantId: U, name: "Duka U Tawi", code: "UT", isActive: true, createdAt: new Date().toISOString() }));
    await expect(asAll.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [branchU], allDepartments: false })).rejects.toThrow(/Branch haihusiani/);
  });

  it("removing a department takes it off users who had several", async () => {
    const { t, asAll, cashBar, bar, lounge } = await setup();
    await asAll.mutation(api.maintenance.updateUser, { userId: cashBar, branchIds: [bar, lounge], allDepartments: false });
    await asAll.mutation(api.tenants.removeDepartment, { branchId: lounge });
    const doc = await t.run(async (ctx) => await ctx.db.get("users", cashBar));
    expect(doc?.branchId).toBe(bar);
    expect(doc?.branchIds).toBeUndefined();
    expect(doc?.branchPicked).toBe(false); // left with one department: tied to it
  });
});
