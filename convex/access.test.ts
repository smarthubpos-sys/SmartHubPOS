import { describe, expect, it } from "vitest";
import { canAccessRecord, filterScoped, requireBusinessScope } from "./access";

describe("tenant and branch access helpers", () => {
  const officeA = "office-A";
  const officeB = "office-B";
  const branchA1 = "branch-A1";
  const branchA2 = "branch-A2";
  const records = [
    { _id: "1", tenantId: officeA, branchId: branchA1 },
    { _id: "2", tenantId: officeA, branchId: branchA2 },
    { _id: "3", tenantId: officeB, branchId: "branch-B1" },
    { _id: "4" }, // legacy unscoped data must not leak to tenant users
  ];

  it("filters tenant users to their office", () => {
    expect(filterScoped({ role: "manager", tenantId: officeA }, records).map((r) => r._id)).toEqual(["1", "2"]);
  });

  it("filters branch users to their assigned branch", () => {
    expect(filterScoped({ role: "cashier", tenantId: officeA, branchId: branchA1 }, records).map((r) => r._id)).toEqual(["1"]);
  });

  it("does not expose another tenant or unscoped legacy records by ID", () => {
    const user = { role: "manager", tenantId: officeA };
    expect(canAccessRecord(user, records[2])).toBe(false);
    expect(canAccessRecord(user, records[3])).toBe(false);
  });

  it("allows Super Admin to inspect records but requires business scope for mutations", () => {
    expect(filterScoped({ role: "super_admin" }, records)).toHaveLength(4);
    expect(() => requireBusinessScope({ role: "super_admin" })).toThrow(/achague biashara/);
  });

  it("restricts Super Admin to the selected business", () => {
    const sa = { role: "super_admin", tenantId: officeA };
    expect(filterScoped(sa, records).map((r) => r._id)).toEqual(["1", "2"]);
    expect(canAccessRecord(sa, records[2])).toBe(false);
    expect(canAccessRecord(sa, records[0])).toBe(true);
    expect(requireBusinessScope(sa)).toEqual({ tenantId: officeA });
  });

  it("rejects unassigned users from business writes", () => {
    expect(() => requireBusinessScope({ role: "manager" })).toThrow(/haijaunganishwa na ofisi/);
  });
});

import { isSuperAdmin, normalizeRole, resolveWriteScope, roleHasPermission } from "./access";

const fakeCtx = (opts: { roles?: any[]; tenants?: any[]; branches?: any[] } = {}) => ({
  db: {
    query: (table: string) => ({
      withIndex: (_name: string, cb?: (q: any) => any) => {
        let field: string | undefined; let value: unknown;
        cb?.({ eq: (f: string, v: unknown) => { field = f; value = v; return { eq: (f2: string, v2: unknown) => { field = f2; value = v2; } }; } });
        const rows = ({ roles: opts.roles, tenants: opts.tenants, branches: opts.branches } as any)[table] ?? [];
        const filtered = field ? rows.filter((r: any) => r[field!] === value) : rows;
        return { first: async () => filtered[0] ?? null, collect: async () => filtered };
      },
    }),
  },
});

describe("role normalization and permissions", () => {
  it("normalizes labels like 'Super Admin' and 'super-admin'", () => {
    expect(normalizeRole("Super Admin")).toBe("super_admin");
    expect(normalizeRole(" super-admin ")).toBe("super_admin");
    expect(isSuperAdmin({ role: "Super Admin" })).toBe(true);
    expect(isSuperAdmin({ role: "viewer" })).toBe(false);
  });

  it("gives supplier management to built-in manager/admin but not viewer/cashier", async () => {
    const ctx = fakeCtx();
    expect(await roleHasPermission(ctx, { role: "manager" }, "suppliers.manage")).toBe(true);
    expect(await roleHasPermission(ctx, { role: "admin" }, "suppliers.manage")).toBe(true);
    expect(await roleHasPermission(ctx, { role: "viewer" }, "suppliers.manage")).toBe(false);
    expect(await roleHasPermission(ctx, { role: "cashier" }, "suppliers.manage")).toBe(false);
    expect(await roleHasPermission(ctx, { role: "super_admin" }, "anything.at.all")).toBe(true);
  });

  it("honors customized roles stored in the database", async () => {
    const ctx = fakeCtx({ roles: [{ name: "cashier", permissions: ["suppliers.manage"] }] });
    expect(await roleHasPermission(ctx, { role: "cashier" }, "suppliers.manage")).toBe(true);
    expect(await roleHasPermission(ctx, { role: "cashier" }, "sales.manage")).toBe(false);
  });
});

describe("resolveWriteScope", () => {
  it("lets Super Admin write before any office exists", async () => {
    expect(await resolveWriteScope(fakeCtx(), { role: "super_admin" })).toEqual({});
  });
  it("attaches Super Admin writes to first active office and branch", async () => {
    const ctx = fakeCtx({ tenants: [{ _id: "T1", isActive: true }], branches: [{ _id: "B1", tenantId: "T1", isActive: true }] });
    expect(await resolveWriteScope(ctx, { role: "super_admin" })).toEqual({ tenantId: "T1", branchId: "B1" });
  });
  it("still requires an office for normal users", async () => {
    await expect(resolveWriteScope(fakeCtx(), { role: "manager" })).rejects.toThrow(/haijaunganishwa na ofisi/);
    expect(await resolveWriteScope(fakeCtx(), { role: "manager", tenantId: "T1", branchId: "B2" })).toEqual({ tenantId: "T1", branchId: "B2" });
  });
});
