import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { activeDepartments, allowedBranchIds, isSuperAdmin, logAudit, requireActiveUser, requirePermission, roleHasPermission } from "./access";
import type { UserLike } from "./access";
import { accRows, entryRows, isDate, round2, summarize, type JEntry, type Row } from "./reportCore";

/**
 * PERIOD REPORT (Accounts > Ripoti ya Siku / Mwezi / Mwaka)
 *
 * `chunk` reads the posted journal entries of a SHORT date range (through the tenant+date index) and returns small additive rows,
 * one section per department. The screen asks for the range in pieces (a week at a time, halving a piece when it is too big)
 * and adds the pieces up, so a whole year never has to be read by one call.
 * `save` keeps a snapshot of a generated report (history table); `history` / `getRun` list and reopen them.
 */

const MAX_ENTRIES = 1200; // entries per call (each has ~6 lines): keeps one call far below Convex read limits
const MAX_SNAPSHOT = 900_000; // bytes of JSON kept per saved report (a document may not exceed 1 MiB)
const bkey = (branchId: unknown) => (branchId ? String(branchId) : "none");

/** Departments the user may report on: a user tied to one department sees only that one; others see all (or one they choose). */
async function reportScope(ctx: QueryCtx, user: UserLike, requested: string | undefined) {
  if (!user.tenantId) return { tenantId: null, departments: [] as Array<{ id: string; name: string }>, only: null as string | null, hasDepartments: false };
  const departments = (await activeDepartments(ctx, user.tenantId)).map((b) => ({ id: String(b._id), name: b.name }));
  // Same rule as the top-bar department switch (tenants.current): a user tied to one department cannot look at the others.
  // A user given several departments reports on the one he is working in now (switch in the top bar to report on another).
  const canSwitch = (isSuperAdmin(user) || !user.branchId || !!user.branchPicked) && !allowedBranchIds(user);
  const fixed = canSwitch ? null : String(user.branchId);
  const only = fixed ?? (requested && requested !== "all" ? requested : null);
  if (only && !departments.some((d) => d.id === only)) throw new Error("Idara hiyo haipo kwenye biashara yako.");
  return { tenantId: user.tenantId, departments, only, hasDepartments: departments.length > 0 };
}

export const options = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    const scope = await reportScope(ctx, user, undefined);
    return { departments: scope.departments, fixedDepartment: scope.only, hasDepartments: scope.hasDepartments };
  },
});

export const chunk = query({
  args: { from: v.string(), to: v.string(), scope: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    if (!isDate(a.from) || !isDate(a.to) || a.to < a.from) throw new Error("Tarehe za ripoti si sahihi.");
    const sc = await reportScope(ctx, user, a.scope);
    if (!sc.tenantId) return { tooBig: false, sections: [] as Array<{ bk: string; rows: Row[] }> };
    // One department chosen/locked: read only its entries, so a big department cannot make a small one "too big".
    const tenantId = sc.tenantId;
    const onlyBranch = sc.only ? ctx.db.normalizeId("branches", sc.only) : null;
    const entries = onlyBranch
      ? await ctx.db.query("journalEntries").withIndex("by_scope_date", (q) => q.eq("tenantId", tenantId).eq("branchId", onlyBranch).gte("entryDate", a.from).lte("entryDate", a.to)).take(MAX_ENTRIES + 1)
      : await ctx.db.query("journalEntries").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("entryDate", a.from).lte("entryDate", a.to)).take(MAX_ENTRIES + 1);
    if (entries.length > MAX_ENTRIES) return { tooBig: true, sections: [] as Array<{ bk: string; rows: Row[] }> };

    const accounts = new Map<string, Doc<"accounts"> | null>();
    const byBranch = new Map<string, Map<string, Row>>();
    for (const e of entries) {
      if (e.status !== "posted") continue;
      const bk = bkey(e.branchId);
      if (sc.only && bk !== sc.only) continue;
      const lines: JEntry["lines"] = [];
      for (const l of await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()) {
        const k = String(l.accountId);
        if (!accounts.has(k)) accounts.set(k, await ctx.db.get("accounts", l.accountId));
        const ac = accounts.get(k);
        if (ac) lines.push({ code: ac.code, name: ac.name, type: ac.type, subtype: ac.subtype, debit: l.debit, credit: l.credit });
      }
      let acc = byBranch.get(bk); if (!acc) { acc = new Map(); byBranch.set(bk, acc); }
      entryRows({ entryDate: e.entryDate, sourceType: e.sourceType, lines }, acc);
    }
    return { tooBig: false, sections: [...byBranch.entries()].map(([bk, acc]) => ({ bk, rows: accRows(acc) })) };
  },
});

/** Business header printed on the report (name, address, phone, currency). */
export const header = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    if (!user.tenantId) return null;
    const tenant = await ctx.db.get("tenants", user.tenantId);
    const rows = await ctx.db.query("companySettings").withIndex("by_tenant", (q) => q.eq("tenantId", user.tenantId)).collect();
    const c = rows.find((r) => !r.branchId) ?? rows[0] ?? null;
    return { businessName: c?.companyName || tenant?.name || "", address: c?.address ?? "", phone: c?.phone ?? "", email: c?.email ?? "", tin: c?.taxId ?? "", currencySymbol: c?.currencySymbol ?? "TSh", decimalPlaces: c?.decimalPlaces ?? 0, preparedBy: user.name ?? user.username ?? user.email ?? "" };
  },
});

const sectionValidator = v.object({ bk: v.string(), name: v.string(), rows: v.array(v.object({ g: v.string(), k: v.string(), label: v.string(), a: v.number(), b: v.number(), c: v.number() })) });

export const save = mutation({
  args: { period: v.string(), startDate: v.string(), endDate: v.string(), scope: v.string(), scopeLabel: v.string(), title: v.string(), sections: v.array(sectionValidator) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    if (!user.tenantId) throw new Error("Chagua biashara kwanza.");
    if (!["day", "month", "year"].includes(a.period)) throw new Error("Aina ya ripoti si sahihi.");
    if (!isDate(a.startDate) || !isDate(a.endDate) || a.endDate < a.startDate) throw new Error("Tarehe za ripoti si sahihi.");
    // The department scope of a saved report must be one this user may report on (a department-locked user: only his own).
    const sc = await reportScope(ctx, user, a.scope);
    if (sc.only ? a.scope !== sc.only : a.scope !== "all") throw new Error("Idara ya ripoti hairuhusiwi kwa akaunti yako.");
    if (sc.only && a.sections.some((s) => s.bk !== sc.only)) throw new Error("Ripoti ina data ya idara nyingine.");
    const all = summarize(a.sections.flatMap((s) => s.rows));
    // The snapshot must stay under the document limit: the per-day rows are the only large part, drop them if needed.
    let sections = a.sections;
    if (JSON.stringify(sections).length > MAX_SNAPSHOT) sections = sections.map((s) => ({ ...s, rows: s.rows.filter((r) => r.g !== "day") }));
    const data = JSON.stringify({ sections });
    if (data.length > MAX_SNAPSHOT) throw new Error("Ripoti ni kubwa mno kuhifadhiwa; chagua kipindi kifupi au idara moja.");
    const id = await ctx.db.insert("reportRuns", {
      tenantId: user.tenantId, period: a.period, startDate: a.startDate, endDate: a.endDate, scope: a.scope, scopeLabel: a.scopeLabel.slice(0, 120), title: a.title.slice(0, 160),
      netProfit: round2(all.netProfit), netSales: round2(all.netSales), totalExpenses: round2(all.totalExpenses), data,
      createdBy: user._id, createdByName: user.name ?? user.username ?? user.email ?? "user", createdAt: new Date().toISOString(),
    });
    await logAudit(ctx, user, { action: "generate_period_report", module: "accounts", referenceId: String(id), referenceType: "reportRun", details: `${a.period} ${a.startDate}..${a.endDate} ${a.scopeLabel}` });
    return id;
  },
});

/** Newest saved reports first (a user tied to one department sees only that department's reports). */
export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    const tenantId = user.tenantId;
    if (!tenantId) return [];
    const sc = await reportScope(ctx, user, undefined);
    const rows = await ctx.db.query("reportRuns").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).order("desc").take(Math.min(Math.max(Math.floor(a.limit ?? 30), 1), 100));
    return rows.filter((r) => !sc.only || r.scope === sc.only).map((r) => ({ _id: r._id, title: r.title, period: r.period, startDate: r.startDate, endDate: r.endDate, scopeLabel: r.scopeLabel, netSales: r.netSales, totalExpenses: r.totalExpenses, netProfit: r.netProfit, createdByName: r.createdByName, createdAt: r.createdAt }));
  },
});

export const getRun = query({
  args: { id: v.id("reportRuns") },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    const r = await ctx.db.get("reportRuns", a.id);
    if (!r || r.tenantId !== user.tenantId) return null;
    const sc = await reportScope(ctx, user, undefined);
    if (sc.only && r.scope !== sc.only) return null;
    return { _id: r._id, title: r.title, period: r.period, startDate: r.startDate, endDate: r.endDate, scope: r.scope, scopeLabel: r.scopeLabel, createdByName: r.createdByName, createdAt: r.createdAt, sections: (JSON.parse(r.data) as { sections: Array<{ bk: string; name: string; rows: Row[] }> }).sections };
  },
});

/** Delete a saved report snapshot. Super Admin only; never deletes accounting transactions. */
export const deleteRun = mutation({
  args: { id: v.id("reportRuns") },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");

    if (!isSuperAdmin(user)) {
      throw new Error("Super Admin pekee ndiye anayeruhusiwa kufuta ripoti.");
    }

    if (!user.tenantId) throw new Error("Chagua biashara kwanza.");

    const report = await ctx.db.get("reportRuns", a.id);
    if (!report || report.tenantId !== user.tenantId) {
      throw new Error("Ripoti haipo kwenye biashara yako.");
    }

    await logAudit(ctx, user, {
      action: "delete_period_report",
      module: "accounts",
      referenceId: String(report._id),
      referenceType: "reportRun",
      details: `${report.title} ${report.startDate}..${report.endDate}`,
    });

    await ctx.db.delete("reportRuns", report._id);
    return { success: true };
  },
});