import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

describe("a user who must change the password", () => {
  it("can still load the shell (empty permissions) but every other call stays refused", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", { name: "Racruz", code: "RAC", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
      return await ctx.db.insert("users", { name: "admin", username: "admin", role: "admin", tenantId, isActive: true, requirePasswordChange: true });
    });
    const asAdmin = t.withIdentity({ subject: id, tokenIdentifier: "x|1" });
    expect(await asAdmin.query(api.maintenance.myPermissions, {})).toEqual([]);
    await expect(asAdmin.query(api.products.listActive, {})).rejects.toThrow(/password change required/);
  });
});
