import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { canAccessRecord, requireActiveUser, roleHasPermission, scopedRows } from "./access";
import { newChallenge } from "./biometric";
import { KIOSK_PERMISSION, effectiveModules } from "./permissions";
import { PIN_PATTERN, pinLookupKey } from "./pinCrypto";

/**
 * Shared work device (kiosk). The employee names himself first with his Staff PIN or his employee number, and only then
 * confirms with the fingerprint. The challenge handed out here is tied to THAT employee, and biometric.authenticate refuses
 * any fingerprint credential that belongs to someone else, so choosing a colleague's name is no longer possible.
 *
 * Wrong numbers are limited per business (their own counter: they never lock the main PIN sign-in of other businesses).
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60_000;
const PAUSE_MS = 5 * 60_000;

async function failureGuard(ctx: MutationCtx, tenantId: Id<"tenants">) {
  const key = `kiosk:${tenantId}`;
  return { key, row: await ctx.db.query("pinLoginGuard").withIndex("by_key", (q) => q.eq("key", key)).first() };
}

async function employeeByPin(ctx: MutationCtx, user: Doc<"users">, pin: string): Promise<Doc<"employees"> | null> {
  const lookup = await pinLookupKey(pin);
  const owners = (await ctx.db.query("users").withIndex("by_pin_lookup", (q) => q.eq("pinLookup", lookup)).take(50))
    .filter((u) => u.tenantId === user.tenantId && u.tokenIdentifier === undefined && u.isActive !== false && u.pinLoginEnabled === true && u.employeeId !== undefined);
  // A PIN that matched two people (old data) identifies nobody.
  return owners.length === 1 && owners[0].employeeId ? await ctx.db.get("employees", owners[0].employeeId) : null;
}

export const identify = mutation({
  args: { identifier: v.string() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx);
    if (!(await roleHasPermission(ctx, user, KIOSK_PERMISSION))) throw new ConvexError(`Forbidden: permission "${KIOSK_PERMISSION}" required`);
    const tenantId = user.tenantId;
    if (!tenantId) throw new ConvexError("Chagua biashara kwanza.");
    const tenant = await ctx.db.get("tenants", tenantId);
    const modules = effectiveModules(tenant?.modules, undefined);
    if (modules && !modules.includes("payroll")) throw new ConvexError("Forbidden: module not available for your account");

    const now = Date.now();
    const { key, row: guard } = await failureGuard(ctx, tenantId);
    if ((guard?.lockedUntil ?? 0) > now) return { ok: false as const, locked: true, message: "Majaribio mengi yasiyo sahihi. Subiri dakika chache kisha ujaribu tena." };

    const id = a.identifier.trim();
    let employee: Doc<"employees"> | null = null;
    if (id.length > 0 && id.length <= 32) {
      if (PIN_PATTERN.test(id)) employee = await employeeByPin(ctx, user, id);
      if (!employee) {
        const code = id.toUpperCase();
        employee = (await scopedRows(ctx, user, "employees")).find((e) => e.employeeCode.trim().toUpperCase() === code) ?? null;
      }
    }
    if (!employee || employee.tenantId !== tenantId || !employee.isActive || !canAccessRecord(user, employee)) {
      // Recorded and RETURNED (not thrown): a thrown error would roll the failure counter back.
      if (!guard) await ctx.db.insert("pinLoginGuard", { key, failures: 1, windowStart: now });
      else {
        const fresh = now - guard.windowStart > WINDOW_MS;
        const failures = (fresh ? 0 : guard.failures) + 1;
        await ctx.db.patch("pinLoginGuard", guard._id, failures >= MAX_FAILURES ? { failures: 0, windowStart: now, lockedUntil: now + PAUSE_MS } : { failures, windowStart: fresh ? now : guard.windowStart });
      }
      return { ok: false as const, locked: false, message: "Namba haikupatikana. Jaribu tena." };
    }
    if (guard && guard.failures > 0) await ctx.db.patch("pinLoginGuard", guard._id, { failures: 0, windowStart: now });

    const credentials = await ctx.db.query("biometricCredentials").withIndex("by_employee", (q) => q.eq("employeeId", employee._id)).collect();
    if (credentials.length === 0) return { ok: false as const, locked: false, message: "Mfanyakazi huyu hajasajiliwa alama ya kidole. Muone Manager au HR." };
    const challenge = await newChallenge(ctx, user._id, "auth", employee._id);
    return { ok: true as const, challenge, credentialIds: credentials.map((c) => c.credentialId), employeeName: employee.name, employeeCode: employee.employeeCode };
  },
});
