import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { canAccessRecord, filterScoped, isManagerRole, logAudit, requireActiveUser, requireManager, resolveWriteScope, scopedRows } from "./access";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const all = (await isManagerRole(ctx, user)) ? (await scopedRows(ctx, user, "supportTickets")) : await ctx.db.query("supportTickets").withIndex("by_user", (q) => q.eq("createdBy", user._id)).collect();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
});

export const create = mutation({
  args: { subject: v.string(), message: v.string(), category: v.string() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx);
    const scope = await resolveWriteScope(ctx, user).catch(() => ({} as Awaited<ReturnType<typeof resolveWriteScope>>));
    if (!a.subject.trim() || !a.message.trim()) throw new ConvexError("Mada na maelezo vinahitajika.");
    if (!["question", "problem", "request", "other"].includes(a.category)) throw new ConvexError("Aina ya ombi si sahihi.");
    if (a.subject.length > 140 || a.message.length > 4000) throw new ConvexError("Maandishi ni marefu mno.");
    const id = await ctx.db.insert("supportTickets", { ...scope, subject: a.subject.trim(), message: a.message.trim(), category: a.category, status: "open", createdBy: user._id, createdByName: user.name ?? user.username ?? "user", createdAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "create_ticket", module: "help", referenceId: String(id), details: a.subject.trim() });
    return id;
  },
});

export const respond = mutation({
  args: { id: v.id("supportTickets"), reply: v.optional(v.string()), close: v.boolean() },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx);
    const t = await ctx.db.get("supportTickets", a.id);
    if (!t || !canAccessRecord(user, t)) throw new ConvexError("Ombi halipatikani.");
    const patch: Record<string, unknown> = { status: a.close ? "closed" : t.status };
    if (a.reply?.trim()) Object.assign(patch, { reply: a.reply.trim(), repliedBy: user.name ?? user.username ?? "user", repliedAt: new Date().toISOString() });
    await ctx.db.patch("supportTickets", a.id, patch);
    return a.id;
  },
});

export const close = mutation({
  args: { id: v.id("supportTickets") },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx);
    const t = await ctx.db.get("supportTickets", a.id);
    if (!t || (String(t.createdBy) !== String(user._id) && !((await isManagerRole(ctx, user)) && canAccessRecord(user, t)))) throw new ConvexError("Ombi halipatikani.");
    await ctx.db.patch("supportTickets", a.id, { status: "closed" });
    return a.id;
  },
});
