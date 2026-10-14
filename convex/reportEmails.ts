import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const reportEmailContext = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, { subject }) => {
    const userId = ctx.db.normalizeId("users", subject.split("|")[0]);
    const user = userId ? await ctx.db.get("users", userId) : null;
    if (!user || user.isActive === false || !user.tenantId) throw new Error("Akaunti haiwezi kutuma ripoti.");
    const tenant = await ctx.db.get("tenants", user.tenantId);
    if (!tenant || tenant.isActive === false) throw new Error("Biashara haipo au imesimamishwa.");
    const rows = await ctx.db.query("appSettings").withIndex("by_scope", (q) => q.eq("tenantId", user.tenantId).eq("branchId", undefined)).collect();
    const setting = rows.find((r) => r.key === "system");
    let system: Record<string, unknown> = {};
    try { system = setting ? JSON.parse(setting.value) : {}; } catch { /* invalid settings */ }
    const company = (await ctx.db.query("companySettings").withIndex("by_tenant", (q) => q.eq("tenantId", user.tenantId)).first());
    return {
      recipients: String(system.reportEmailRecipients ?? "").split(/[;,\n]/).map((x: string) => x.trim()).filter(Boolean),
      companyName: company?.companyName ?? tenant.name ?? "SmartHubPOS",
      tenantId: String(user.tenantId),
    };
  },
});

export const sendReport = action({
  args: { title: v.string(), rows: v.array(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))), startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ sent: boolean; recipients: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Ingia kwanza kutuma ripoti.");
    if (args.rows.length > 500) throw new Error("Ripoti ina mistari mingi sana. Punguza kipindi hadi mistari 500 au chini.");
    const context: { recipients: string[]; companyName: string; tenantId: string } = await ctx.runQuery(internal.reportEmails.reportEmailContext, { subject: identity.subject });
    if (!context.recipients.length) throw new Error("Weka email za wapokeaji kwenye Maintenance > System Setup kwanza.");
    const key = process.env.RESEND_API_KEY;
    const from = process.env.REPORTS_FROM_EMAIL;
    if (!key || !from) throw new Error("Email haijasanidiwa. Weka RESEND_API_KEY na REPORTS_FROM_EMAIL kwenye Convex environment variables.");
    const cols = Object.keys(args.rows[0] ?? {});
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const table = args.rows.length ? `<table style="border-collapse:collapse;width:100%"><thead><tr>${cols.map((c) => `<th style="border:1px solid #ddd;padding:8px;text-align:left">${escape(c)}</th>`).join("")}</tr></thead><tbody>${args.rows.map((row) => `<tr>${cols.map((c) => `<td style="border:1px solid #ddd;padding:8px">${escape(row?.[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "<p>Hakuna taarifa kwenye ripoti hii.</p>";
    const period = args.startDate || args.endDate ? `<p>Kipindi: ${escape(args.startDate ?? "—")} hadi ${escape(args.endDate ?? "—")}</p>` : "";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: context.recipients, subject: `${context.companyName} — ${args.title}`, html: `<div style="font-family:Arial,sans-serif"><h2>${escape(context.companyName)}</h2><h3>${escape(args.title)}</h3>${period}<p>Imetumwa na SmartHubPOS.</p>${table}</div>` }),
    });
    if (!response.ok) throw new Error(`Imeshindikana kutuma email (${response.status}). Hakiki mipangilio ya Resend na anwani ya mtumaji.`);
    return { sent: true, recipients: context.recipients.length };
  },
});
