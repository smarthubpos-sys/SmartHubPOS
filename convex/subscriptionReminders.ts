import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { planStatus, tzToday } from "./plans";

/** Days before the last day of a subscription / demo on which the business is e-mailed (0 = the last day itself). */
export const REMIND_AT = [7, 3, 1, 0];
export const reminderKey = (tenantId: string, endsAt: string, daysLeft: number) => `sub-remind:${tenantId}:${endsAt}:${daysLeft}`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Businesses that must be reminded today and have not been yet, with the people to e-mail (saved report recipients + admins that have an e-mail). */
export const due = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = tzToday();
    const out: Array<{ tenantId: string; name: string; plan: "demo" | "paid"; endsAt: string; daysLeft: number; key: string; recipients: string[] }> = [];
    for (const tenant of await ctx.db.query("tenants").collect()) {
      if (tenant.isActive === false) continue;
      const s = planStatus(tenant, today);
      if (s.plan === "none" || s.expired || s.endsAt === undefined || s.daysLeft === undefined || !REMIND_AT.includes(s.daysLeft)) continue;
      const key = reminderKey(String(tenant._id), s.endsAt, s.daysLeft);
      if (await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).first()) continue; // already sent
      const found = new Set<string>();
      const setting = (await ctx.db.query("appSettings").withIndex("by_scope", (q) => q.eq("tenantId", tenant._id).eq("branchId", undefined)).collect()).find((r) => r.key === "system");
      try { for (const x of String((setting ? JSON.parse(setting.value) : {}).reportEmailRecipients ?? "").split(/[;,\n]/)) found.add(x.trim().toLowerCase()); } catch { /* invalid settings: ignore */ }
      for (const u of await ctx.db.query("users").withIndex("by_scope", (q) => q.eq("tenantId", tenant._id)).collect()) if (u.role === "admin" && u.isActive !== false && u.email) found.add(u.email.trim().toLowerCase());
      const recipients = [...found].filter((x) => x.length <= 254 && EMAIL.test(x)).slice(0, 10);
      if (recipients.length) out.push({ tenantId: String(tenant._id), name: tenant.name, plan: s.plan, endsAt: s.endsAt, daysLeft: s.daysLeft, key, recipients });
    }
    return out;
  },
});

/** Remembers that a reminder was sent, so the daily job never e-mails the same one twice (reuses the rateLimits table: no schema change). */
export const markSent = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    if (!(await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).first())) await ctx.db.insert("rateLimits", { key, count: 1, windowStart: Date.now() });
    return null;
  },
});

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function reminderText(name: string, plan: "demo" | "paid", endsAt: string, daysLeft: number) {
  const what = plan === "demo" ? "demo yako" : "usajili wako";
  const subject = daysLeft === 0 ? `${name}: ${what} unaisha leo` : `${name}: ${what} unaisha baada ya siku ${daysLeft}`;
  const body = `${daysLeft === 0 ? `Leo ndiyo siku ya mwisho ya ${what}` : `${what[0].toUpperCase()}${what.slice(1)} unaisha baada ya siku ${daysLeft}`} (${endsAt}). Lipia mapema ili mfumo usikatike na data yako ibaki salama.`;
  return { subject, body };
}

/** Daily job: e-mails every business whose subscription ends in 7, 3 or 1 day(s) or today. Does nothing (quietly) until RESEND_API_KEY and REPORTS_FROM_EMAIL are set. */
export const sendDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number; failed: number }> => {
    const key = process.env.RESEND_API_KEY, from = process.env.REPORTS_FROM_EMAIL;
    if (!key || !from) return { sent: 0, failed: 0 };
    const contact = process.env.SUBSCRIPTION_CONTACT?.trim(); // e.g. "WhatsApp +255 7xx xxx xxx" shown at the bottom of the e-mail
    let sent = 0, failed = 0;
    for (const d of await ctx.runQuery(internal.subscriptionReminders.due, {})) {
      const { subject, body } = reminderText(d.name, d.plan, d.endsAt, d.daysLeft);
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: d.recipients, subject, html: `<div style="font-family:Arial,sans-serif"><h2>${esc(d.name)}</h2><p>${esc(body)}</p>${contact ? `<p>${esc(contact)}</p>` : ""}<p style="color:#888;font-size:12px">SmartHubPOS</p></div>` }),
        });
        if (!res.ok) { failed++; continue; }
        await ctx.runMutation(internal.subscriptionReminders.markSent, { key: d.key });
        sent++;
      } catch { failed++; }
    }
    return { sent, failed };
  },
});
