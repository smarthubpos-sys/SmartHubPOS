import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import { canAccessRecord, filterScoped, isDepartmentLocked, sameDepartment } from "./access";
import { MODULE_MANAGE_PERMISSION } from "./permissions";

const id = <T extends string>(s: string) => s as unknown as Id<T extends "t" ? "tenants" : "branches">;
const T1 = id<"t">("tenant1") as Id<"tenants">;
const T2 = id<"t">("tenant2") as Id<"tenants">;
const BAR = id<"b">("bar") as Id<"branches">;
const KITCHEN = id<"b">("kitchen") as Id<"branches">;

const rows = [
  { n: "bar sale", tenantId: T1, branchId: BAR },
  { n: "kitchen sale", tenantId: T1, branchId: KITCHEN },
  { n: "business-level", tenantId: T1 },
  { n: "other business", tenantId: T2, branchId: BAR },
];
const names = (u: Parameters<typeof filterScoped>[0]) => filterScoped(u, rows).map((r) => r.n);

describe("a department's data stays in that department", () => {
  it("a user working in the Bar sees only Bar rows, never Kitchen, business-level or another business", () => {
    expect(names({ tenantId: T1, branchId: BAR, role: "cashier" })).toEqual(["bar sale"]);
    expect(names({ tenantId: T1, branchId: KITCHEN, role: "cashier" })).toEqual(["kitchen sale"]);
  });

  it("a staff user with no department in a business with departments sees NO department's rows (not a mix of all)", () => {
    const manager = { tenantId: T1, role: "cashier", departmentsActive: true };
    expect(isDepartmentLocked(manager)).toBe(true);
    expect(names(manager)).toEqual(["business-level"]);
    expect(canAccessRecord(manager, rows[0])).toBe(false);
    expect(canAccessRecord(manager, rows[1])).toBe(false);
  });

  it("the lock flag binds any user it is set on; a Super Admin with no business still sees the picker view", () => {
    expect(names({ tenantId: T1, role: "super_admin", departmentsActive: true })).toEqual(["business-level"]);
    expect(filterScoped({ role: "super_admin" }, rows)).toHaveLength(4);
  });

  it("a business WITHOUT departments works exactly as before", () => {
    const plain = { tenantId: T1, role: "manager" };
    expect(isDepartmentLocked(plain)).toBe(false);
    expect(names(plain)).toEqual(["bar sale", "kitchen sale", "business-level"]);
  });

  it("choosing a department lifts the lock for that department only", () => {
    const picked = { tenantId: T1, role: "manager", departmentsActive: true, branchId: KITCHEN };
    expect(isDepartmentLocked(picked)).toBe(false);
    expect(sameDepartment(picked, KITCHEN)).toBe(true);
    expect(sameDepartment(picked, BAR)).toBe(false);
    expect(sameDepartment(picked, undefined)).toBe(false);
  });
});

describe("a permission the Super Admin gives is honoured by the manager-only checks of every module that is not an everyday staff module", () => {
  it("stock.manage and purchasing.manage now open their manager-only screens, like payroll and accounts already did", () => {
    expect(MODULE_MANAGE_PERMISSION.stock).toBe("stock.manage");
    expect(MODULE_MANAGE_PERMISSION.purchasing).toBe("purchasing.manage");
    expect(MODULE_MANAGE_PERMISSION.payroll).toBe("payroll.manage");
  });
  it("Sales is NOT in the list: Cashier and Waiter hold sales.manage by default and must not become managers by it", () => {
    expect(MODULE_MANAGE_PERMISSION.sales).toBeUndefined();
  });
});
