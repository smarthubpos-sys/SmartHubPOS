import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

/**
 * In production a plain `Error` thrown by the server reaches the screen as "Server Error", so a person who was simply
 * refused looked like a system fault. Every refusal is now a ConvexError, whose text (`data`) reaches the screen.
 */
describe("permission refusals reach the screen as readable ConvexErrors", () => {
  it("a user who must change the password is refused with a ConvexError carrying the reason", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", { name: "Racruz", code: "RAC", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
      return await ctx.db.insert("users", { name: "admin", username: "admin", role: "admin", tenantId, isActive: true, requirePasswordChange: true });
    });
    const asAdmin = t.withIdentity({ subject: id, tokenIdentifier: "x|1" });
    const error = await asAdmin.query(api.products.listActive, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<string>).data).toBe("Forbidden: password change required");
  });

  it("a signed-out caller is refused with a ConvexError saying Unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const error = await t.query(api.products.listActive, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<string>).data).toBe("Unauthenticated");
  });
});
