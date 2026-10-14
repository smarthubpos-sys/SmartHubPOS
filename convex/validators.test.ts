import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now });
    const admin = await ctx.db.insert("users", { name: "Admin", username: "admin", role: "admin", tenantId, isActive: true });
    return { admin };
  });
  return { t, asAdmin: t.withIdentity({ subject: ids.admin, tokenIdentifier: "x|1" }) };
}

describe("typed argument validators", () => {
  it("saves the settings payloads the screens really send (nested lists and objects)", async () => {
    const { asAdmin } = await setup();
    await asAdmin.mutation(api.maintenance.saveSetting, { key: "taxes", value: { priceIncludesTax: true, rates: [{ name: "VAT", rate: 18 }, { name: "Service", rate: 5 }] } });
    await asAdmin.mutation(api.maintenance.saveSetting, { key: "hardware", value: { paperWidth: "80mm", autoPrintReceipt: true, receiptDevice: { kind: "usb", name: "EPSON", vendorId: 1208, productId: 7 } } });
    await asAdmin.mutation(api.maintenance.saveSetting, { key: "numbering", value: { invoice: { prefix: "INV-", padding: 6, next: 1 }, purchase: { prefix: "PUR-", padding: 6, next: 1 } } });
    await asAdmin.mutation(api.maintenance.saveSetting, { key: "system", value: { dateFormat: "dd/MM/yyyy", receiptFooter: "Asante", defaultPaymentMethod: "Cash", reportEmailRecipients: "a@b.co" } });
    await asAdmin.mutation(api.maintenance.saveSetting, { key: "language", value: { language: "en" } });
    await asAdmin.mutation(api.maintenance.saveSetting, { key: "security", value: { minPasswordLength: 10, sessionTimeoutMinutes: 30, requirePasswordChangeForNewUsers: true } });
    const s = await asAdmin.query(api.maintenance.getSettings, {});
    expect(s?.app.taxes).toEqual({ priceIncludesTax: true, rates: [{ name: "VAT", rate: 18 }, { name: "Service", rate: 5 }] });
    expect(s?.app.hardware).toMatchObject({ receiptDevice: { kind: "usb", name: "EPSON" } });
  });

  it("still rejects invalid values", async () => {
    const { asAdmin } = await setup();
    await expect(asAdmin.mutation(api.maintenance.saveSetting, { key: "language", value: { language: "fr" } })).rejects.toThrow(/sw au en/);
    await expect(asAdmin.mutation(api.maintenance.saveSetting, { key: "security", value: { minPasswordLength: 3, sessionTimeoutMinutes: 30 } })).rejects.toThrow(/8–64/);
  });
});
