import { mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSuperAdminUser } from "./access";
import { surfaceError } from "./surfaceError";

/**
 * ONE print layout for every business.
 * The invoice, bill and payment receipt all read the business's own company details, paper width and footer. A business that was
 * created without them printed a tiny, empty slip. These defaults are the same values the existing businesses use, so a new
 * business prints exactly like the others until its owner changes them in Maintenance.
 */
export const DEFAULT_HARDWARE = { paperWidth: "80mm", autoPrintReceipt: false, openCashDrawer: false } as const;
export const DEFAULT_RECEIPT_FOOTER = "Asante kwa kununua!";

/** Fills in ONLY what is missing (company row, hardware paper, receipt footer). Never overwrites what the business already set. Safe to run twice. */
export async function seedPrintDefaults(ctx: MutationCtx, tenantId: Id<"tenants">, name: string, currency?: string): Promise<{ company: boolean; hardware: boolean; system: boolean }> {
  const now = new Date().toISOString();
  const out = { company: false, hardware: false, system: false };
  const companies = await ctx.db.query("companySettings").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
  if (companies.length === 0) {
    const cur = (currency || "TZS").toUpperCase();
    await ctx.db.insert("companySettings", { tenantId, companyName: name.trim() || "Biashara", currency: cur, currencySymbol: cur === "TZS" ? "TSh" : cur, decimalPlaces: cur === "TZS" ? 0 : 2 });
    out.company = true;
  } else if (!companies.some((c) => c.companyName?.trim())) {
    await ctx.db.patch("companySettings", companies[0]._id, { companyName: name.trim() || "Biashara" });
    out.company = true;
  }
  const rows = (await ctx.db.query("appSettings").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()).filter((r) => r.branchId === undefined);
  if (!rows.some((r) => r.key === "hardware")) { await ctx.db.insert("appSettings", { tenantId, key: "hardware", value: JSON.stringify(DEFAULT_HARDWARE), updatedAt: now }); out.hardware = true; }
  if (!rows.some((r) => r.key === "system")) { await ctx.db.insert("appSettings", { tenantId, key: "system", value: JSON.stringify({ receiptFooter: DEFAULT_RECEIPT_FOOTER }), updatedAt: now }); out.system = true; }
  return out;
}

/** Super Admin, once: gives every EXISTING business that lacks them the same print defaults. Nothing already set is changed. */
export const backfillPrintDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuperAdminUser(ctx);
      let fixed = 0;
      const names: string[] = [];
      for (const t of await ctx.db.query("tenants").collect()) {
        const settings = await ctx.db.query("tenantSettings").withIndex("by_tenant", (q) => q.eq("tenantId", t._id)).first();
        const r = await seedPrintDefaults(ctx, t._id, t.name, settings?.defaultCurrency);
        if (r.company || r.hardware || r.system) { fixed++; names.push(t.name); }
      }
      return { checked: (await ctx.db.query("tenants").collect()).length, fixed, businesses: names };
    } catch (e) { throw surfaceError(e); }
  },
});
