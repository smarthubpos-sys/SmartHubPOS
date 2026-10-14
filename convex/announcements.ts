import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { isSuperAdmin, logAudit, requireActiveUser, requireSuperAdminUser } from "./access";
import { tzToday } from "./plans";

const THEMES = ["blue", "green", "orange", "purple", "red"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URL_OK = /^https:\/\/\S+$/i;

/** Is this announcement visible to a user of `tenantId` today? (Shared with notifications.feed.) */
export function announcementApplies(a: Doc<"announcements">, tenantId: unknown, today: string) {
  if (!a.isActive) return false;
  if (a.tenantId && String(a.tenantId) !== String(tenantId ?? "")) return false;
  if (a.startsAt && today < a.startsAt) return false;
  if (a.endsAt && today > a.endsAt) return false;
  return true;
}

/** Ad-style banners for the signed-in user's business (all businesses + ones aimed at this business). */
export const banners = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const today = tzToday();
    const rows = await ctx.db.query("announcements").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
    return rows
      .filter((r) => r.kind === "banner" && announcementApplies(r, user.tenantId, today))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .slice(0, 8)
      .map((r) => ({ _id: r._id, title: r.title, body: r.body, imageUrl: r.imageUrl, linkUrl: r.linkUrl, theme: r.theme }));
  },
});

/** Super Admin: every announcement with its audience and how many users it reaches. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdminUser(ctx);
    const rows = await ctx.db.query("announcements").order("desc").take(200);
    const tenants = new Map((await ctx.db.query("tenants").collect()).map((t) => [String(t._id), t.name]));
    const perTenant = new Map<string, number>();
    let total = 0;
    for (const u of await ctx.db.query("users").collect()) {
      if (!u.tenantId || isSuperAdmin(u) || u.isActive === false) continue;
      total++;
      perTenant.set(String(u.tenantId), (perTenant.get(String(u.tenantId)) ?? 0) + 1);
    }
    return rows.map((r) => ({ ...r, tenantName: r.tenantId ? tenants.get(String(r.tenantId)) ?? "-" : null, reach: r.tenantId ? perTenant.get(String(r.tenantId)) ?? 0 : total }));
  },
});

export const create = mutation({
  args: {
    kind: v.union(v.literal("banner"), v.literal("message")),
    title: v.string(), body: v.string(),
    imageUrl: v.optional(v.string()), linkUrl: v.optional(v.string()),
    theme: v.optional(v.string()),
    tenantId: v.optional(v.id("tenants")),
    startsAt: v.optional(v.string()), endsAt: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await requireSuperAdminUser(ctx);
    const title = a.title.trim(); const body = a.body.trim();
    if (!title) throw new Error("Weka kichwa cha tangazo.");
    if (title.length > 80) throw new Error("Kichwa kisizidi herufi 80.");
    if (body.length > 1000) throw new Error("Ujumbe usizidi herufi 1000.");
    if (a.kind === "message" && !body) throw new Error("Andika ujumbe.");
    const imageUrl = a.imageUrl?.trim() || undefined; const linkUrl = a.linkUrl?.trim() || undefined;
    if ((imageUrl && !URL_OK.test(imageUrl)) || (linkUrl && !URL_OK.test(linkUrl))) throw new Error("Kiungo kianze na https://");
    const theme = a.theme && (THEMES as readonly string[]).includes(a.theme) ? a.theme : "blue";
    const startsAt = a.startsAt?.trim() || tzToday(); const endsAt = a.endsAt?.trim() || undefined;
    if (!DATE.test(startsAt) || (endsAt && !DATE.test(endsAt))) throw new Error("Tarehe si sahihi.");
    if (endsAt && endsAt < startsAt) throw new Error("Tarehe ya mwisho iwe baada ya ya kuanza.");
    if (a.tenantId && !(await ctx.db.get("tenants", a.tenantId))) throw new Error("Biashara haipo");
    const id = await ctx.db.insert("announcements", { kind: a.kind, title, body, imageUrl, linkUrl, theme, tenantId: a.tenantId, startsAt, endsAt, isActive: true, createdBy: user._id, createdAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "create_announcement", module: "super-admin", referenceId: String(id), details: `${a.kind}: ${title}` });
    return id;
  },
});

export const setActive = mutation({
  args: { id: v.id("announcements"), isActive: v.boolean() },
  handler: async (ctx, a) => { await requireSuperAdminUser(ctx); await ctx.db.patch("announcements", a.id, { isActive: a.isActive }); return a.isActive; },
});

export const remove = mutation({
  args: { id: v.id("announcements") },
  handler: async (ctx, a) => { await requireSuperAdminUser(ctx); await ctx.db.delete("announcements", a.id); return true; },
});
