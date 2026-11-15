import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { isManagerRole, logAudit, roleHasPermission } from "./access";

// E-mailing a report is a way of taking data OUT of the system, so it needs the same right as exporting it (or a manager role).
const EXPORT_PERMISSIONS = ["accounts.export", "sales.export", "stock.export", "purchasing.export", "payroll.export"];
const MAX_PER_HOUR = 15;        // report e-mails one user may send per hour
const MAX_EXTRA_RECIPIENTS = 3; // one-off addresses typed at send time

export const reportEmailContext = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, { subject }) => {
    const userId = ctx.db.normalizeId("users", subject.split("|")[0]);
    const user = userId ? await ctx.db.get("users", userId) : null;
    if (!user || user.isActive === false || !user.tenantId) throw new ConvexError("Akaunti haiwezi kutuma ripoti.");
    const tenant = await ctx.db.get("tenants", user.tenantId);
    if (!tenant || tenant.isActive === false) throw new ConvexError("Biashara haipo au imesimamishwa.");
    let allowed = await isManagerRole(ctx, user);
    for (const p of EXPORT_PERMISSIONS) { if (allowed) break; allowed = await roleHasPermission(ctx, user, p); }
    if (!allowed) throw new ConvexError("Huna ruhusa ya kutuma ripoti kwa email (inahitaji ruhusa ya kutoa/export ripoti).");
    const rows = await ctx.db.query("appSettings").withIndex("by_scope", (q) => q.eq("tenantId", user.tenantId).eq("branchId", undefined)).collect();
    const setting = rows.find((r) => r.key === "system");
    let system: Record<string, unknown> = {};
    try { system = setting ? JSON.parse(setting.value) : {}; } catch { /* invalid settings */ }
    const company = (await ctx.db.query("companySettings").withIndex("by_tenant", (q) => q.eq("tenantId", user.tenantId)).first());
    return {
      recipients: String(system.reportEmailRecipients ?? "").split(/[;,\n]/).map((x: string) => x.trim()).filter(Boolean),
      companyName: company?.companyName ?? tenant.name ?? "SmartHubPOS",
      tenantId: String(user.tenantId),
      userId: user._id,
    };
  },
});

/** Counts one report e-mail for the user (at most MAX_PER_HOUR an hour) and writes it to the audit log; refuses when the limit is reached. */
export const consumeSend = internalMutation({
  args: { userId: v.id("users"), title: v.string(), recipientCount: v.number(), extraDomains: v.array(v.string()) },
  handler: async (ctx, a) => {
    const user = await ctx.db.get("users", a.userId);
    if (!user || user.isActive === false) throw new ConvexError("Akaunti haiwezi kutuma ripoti.");
    const key = `report-mail:${a.userId}`, now = Date.now(), WINDOW = 3600000;
    const row = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (!row) await ctx.db.insert("rateLimits", { key, count: 1, windowStart: now });
    else if (now - row.windowStart >= WINDOW) await ctx.db.patch("rateLimits", row._id, { count: 1, windowStart: now });
    else if (row.count >= MAX_PER_HOUR) throw new ConvexError(`Umefikia kikomo cha ripoti ${MAX_PER_HOUR} kwa saa kupitia email. Jaribu tena baadaye.`);
    else await ctx.db.patch("rateLimits", row._id, { count: row.count + 1 });
    await logAudit(ctx, user, { action: "report_email_sent", module: "reports", details: `${a.title.slice(0, 80)} -> ${a.recipientCount} wapokeaji${a.extraDomains.length ? ` (ziada: ${a.extraDomains.join(", ")})` : ""}` });
    return null;
  },
});

export const sendReport = action({
  args: { title: v.string(), lang: v.optional(v.string()), rows: v.array(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))), startDate: v.optional(v.string()), endDate: v.optional(v.string()), extraTo: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ sent: boolean; recipients: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Ingia kwanza kutuma ripoti.");
    if (args.rows.length > 500) throw new ConvexError("Ripoti ina mistari mingi sana. Punguza kipindi hadi mistari 500 au chini.");
    const context: { recipients: string[]; companyName: string; tenantId: string; userId: Id<"users"> } = await ctx.runQuery(internal.reportEmails.reportEmailContext, { subject: identity.subject });
    // Optional one-off recipient(s) typed at send time, added to the saved list (System Setup).
    const extra = (args.extraTo ?? "").split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (extra.length > MAX_EXTRA_RECIPIENTS) throw new ConvexError(`Unaweza kuongeza email zisizozidi ${MAX_EXTRA_RECIPIENTS} kwa mara moja.`);
    if (extra.some((x) => x.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) throw new ConvexError("Anwani ya email si sahihi.");
    const recipients = [...new Set([...context.recipients, ...extra.map((x) => x.toLowerCase())])].slice(0, 20);
    if (!recipients.length) throw new ConvexError("Weka email za wapokeaji kwenye Maintenance > System Setup kwanza, au andika email ya kupokea.");
    const title = args.title.replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Report"; // no line breaks in the subject
    if (Object.keys(args.rows[0] ?? {}).length > 15) throw new ConvexError("Ripoti ina safu nyingi mno kwa email.");
    await ctx.runMutation(internal.reportEmails.consumeSend, { userId: context.userId, title, recipientCount: recipients.length, extraDomains: [...new Set(extra.map((x) => x.split("@")[1].toLowerCase()))].slice(0, 3) });
    const key = process.env.RESEND_API_KEY;
    const from = process.env.REPORTS_FROM_EMAIL;
    if (!key || !from) throw new ConvexError("Email haijasanidiwa. Weka RESEND_API_KEY na REPORTS_FROM_EMAIL kwenye Convex environment variables.");
    const en = args.lang === "en"; // the report is e-mailed in the language the business uses
    const cols = Object.keys(args.rows[0] ?? {});
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const table = args.rows.length ? `<table style="border-collapse:collapse;width:100%"><thead><tr>${cols.map((c) => `<th style="border:1px solid #ddd;padding:8px;text-align:left">${escape(c)}</th>`).join("")}</tr></thead><tbody>${args.rows.map((row) => `<tr>${cols.map((c) => `<td style="border:1px solid #ddd;padding:8px">${escape(String(row?.[c] ?? "").slice(0, 300))}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<p>${en ? "There is no data in this report." : "Hakuna taarifa kwenye ripoti hii."}</p>`;
    const period = args.startDate || args.endDate ? `<p>${en ? "Period" : "Kipindi"}: ${escape(args.startDate ?? "—")} ${en ? "to" : "hadi"} ${escape(args.endDate ?? "—")}</p>` : "";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject: `${context.companyName} — ${title}`, html: `<div style="font-family:Arial,sans-serif"><h2>${escape(context.companyName)}</h2><h3>${escape(title)}</h3>${period}<p>${en ? "Sent by SmartHubPOS." : "Imetumwa na SmartHubPOS."}</p>${table}</div>` }),
    });
    if (!response.ok) throw new ConvexError(`Imeshindikana kutuma email (${response.status}). Hakiki mipangilio ya Resend na anwani ya mtumaji.`);
    return { sent: true, recipients: recipients.length };
  },
});
