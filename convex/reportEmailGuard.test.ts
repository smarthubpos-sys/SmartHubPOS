import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

/** E-mailing a report takes data out of the system: it needs a manager / export right, and is limited per user per hour. */
async function setup() {
  const t = convexTest(schema, modules);
  const now = new Date().toISOString();
  return { t, ...(await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const manager = await ctx.db.insert("users", { name: "Manager", username: "manager", role: "manager", tenantId, isActive: true });
    const waiter = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, isActive: true });
    return { tenantId, manager, waiter };
  })) };
}

describe("report e-mail guard", () => {
  it("a manager may send; a waiter may not (no flooding or data-out from a low-rights account)", async () => {
    const { t, manager, waiter } = await setup();
    const ok = await t.query(internal.reportEmails.reportEmailContext, { subject: `${manager}|session` });
    expect(ok.userId).toBe(manager);
    await expect(t.query(internal.reportEmails.reportEmailContext, { subject: `${waiter}|session` })).rejects.toThrow(/ruhusa/);
    // a waiter who was explicitly given the export right may
    await t.run(async (ctx) => { await ctx.db.patch("users", waiter, { extraPermissions: ["sales.export"] }); });
    expect((await t.query(internal.reportEmails.reportEmailContext, { subject: `${waiter}|session` })).userId).toBe(waiter);
  });

  it("at most 15 report e-mails an hour per user, each one written to the audit log", async () => {
    const { t, manager } = await setup();
    for (let i = 0; i < 15; i++) await t.mutation(internal.reportEmails.consumeSend, { userId: manager, title: "Daily report", recipientCount: 2, extraDomains: [] });
    await expect(t.mutation(internal.reportEmails.consumeSend, { userId: manager, title: "Daily report", recipientCount: 2, extraDomains: [] })).rejects.toThrow(/kikomo/);
    const logs = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((l) => l.action === "report_email_sent"));
    expect(logs).toHaveLength(15);
  });
});
