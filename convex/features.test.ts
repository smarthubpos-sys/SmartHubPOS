import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenant = await ctx.db.insert("tenants", { name: "Duka", code: "D", isActive: true, createdByToken: "t", createdAt: now });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId: tenant, isActive: true });
    const emp = await ctx.db.insert("employees", { tenantId: tenant, employeeCode: "E1", name: "Asha", startDate: "2026-01-01", basicSalary: 300000, salaryType: "monthly", isActive: true });
    return { tenant, mgr, emp };
  });
  const as = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
  return { t, as, ...ids };
}
const balances = async (t: any) => t.run(async (ctx: any) => {
  const out: Record<string, number> = {};
  for (const l of await ctx.db.query("journalLines").collect()) { const a = await ctx.db.get(l.accountId); out[a.code] = (out[a.code] ?? 0) + l.debit - l.credit; }
  return out;
});

describe("capital receipts", () => {
  it("books equity vs loan to the right accounts and validates the source", async () => {
    const { t, as } = await setup();
    await as.mutation(api.capital.receive, { receiptDate: "2026-02-01", amount: 1000000, sourceType: "director_capital", sourceName: "Mr Juma", depositMethod: "bank" });
    await as.mutation(api.capital.receive, { receiptDate: "2026-02-02", amount: 500000, sourceType: "bank_loan", sourceName: "CRDB", depositMethod: "bank", interestRate: 14, termMonths: 12 });
    const b = await balances(t);
    expect(b["1010"]).toBe(1500000); // bank
    expect(b["3200"]).toBe(-1000000); // directors' capital (equity, credit)
    expect(b["2500"]).toBe(-500000); // bank loan (liability, credit)
    expect((await as.query(api.capital.list, {})).length).toBe(2);
    await expect(as.mutation(api.capital.receive, { receiptDate: "2026-02-02", amount: 10, sourceType: "bank_loan", sourceName: " ", depositMethod: "cash" })).rejects.toThrow(/umetoka/);
    await expect(as.mutation(api.capital.receive, { receiptDate: "2026-02-02", amount: 10, sourceType: "nope", sourceName: "x", depositMethod: "cash" })).rejects.toThrow(/Chanzo/);
  });
});

describe("bills", () => {
  it("accrues, pays partly then fully, and blocks overpayment", async () => {
    const { t, as } = await setup();
    const id = await as.mutation(api.bills.create, { vendor: "TANESCO", category: "electricity", billDate: "2026-03-01", dueDate: "2026-03-15", amount: 100000 });
    await as.mutation(api.bills.pay, { billId: id, amount: 40000, method: "cash", paymentDate: "2026-03-05" });
    await expect(as.mutation(api.bills.pay, { billId: id, amount: 70000, method: "cash", paymentDate: "2026-03-06" })).rejects.toThrow(/yasizidi/);
    await as.mutation(api.bills.pay, { billId: id, amount: 60000, method: "bank", paymentDate: "2026-03-07" });
    const [bill] = await as.query(api.bills.list, {});
    expect(bill.status).toBe("paid");
    const b = await balances(t);
    expect(b["6110"]).toBe(100000);
    expect(b["2100"]).toBe(0);
    expect(b["1000"]).toBe(-40000);
    expect(b["1010"]).toBe(-60000);
  });
});

describe("Excel product import", () => {
  it("creates items with group/unit/opening stock, updates existing, and reports row errors", async () => {
    const { t, as } = await setup();
    const rows = [
      { name: "Sukari 1kg", group: "Chakula", unit: "Kg", sellingPrice: 3000, buyingPrice: 2400, quantity: 50 },
      { name: "Mafuta 1L", group: "chakula", unit: "Lita", sellingPrice: 5000, buyingPrice: 4000, quantity: 20, barcode: "123" },
      { name: "Sukari 1kg" },
      { name: "Chumvi", sellingPrice: -1 },
    ];
    const dry = await as.mutation(api.products.importBatch, { rows, dryRun: true, updateExisting: true });
    expect(dry.created).toBe(2);
    expect(dry.errors).toBe(2);
    expect(await as.query(api.products.list, {})).toHaveLength(0);
    const res = await as.mutation(api.products.importBatch, { rows, dryRun: false, updateExisting: true });
    expect(res.results.map((r) => r.status)).toEqual(["new", "new", "error", "error"]);
    const products = await as.query(api.products.list, {});
    expect(products.map((p) => [p.itemCode, p.currentQty]).sort()).toEqual([["ITM-0001", 50], ["ITM-0002", 20]]);
    expect(await as.query(api.products.listGroups, {})).toHaveLength(1); // "Chakula" and "chakula" share one group
    expect((await balances(t))["1200"]).toBe(50 * 2400 + 20 * 4000);
    const again = await as.mutation(api.products.importBatch, { rows: [{ name: "Sukari 1kg", sellingPrice: 3200, quantity: 99 }], dryRun: false, updateExisting: true });
    expect(again.results[0].status).toBe("update");
    const sugar = (await as.query(api.products.list, {})).find((p) => p.name === "Sukari 1kg")!;
    expect([sugar.sellingPrice, sugar.currentQty]).toEqual([3200, 50]); // price updated, quantity untouched
  });
});

describe("attendance, leave and payroll", () => {
  it("signs in/out once a day and pays hourly staff from worked hours", async () => {
    const { t, as, emp, tenant } = await setup();
    const hourly = await t.run((ctx) => ctx.db.insert("employees", { tenantId: tenant, employeeCode: "E2", name: "Juma", startDate: "2026-01-01", basicSalary: 1000, salaryType: "hourly", isActive: true }));
    const r1 = await as.mutation(api.attendance.recordManual, { employeeId: hourly, kind: "in", tzOffset: 0 });
    await expect(as.mutation(api.attendance.recordManual, { employeeId: hourly, kind: "in", tzOffset: 0 })).rejects.toThrow(/Tayari/);
    await as.mutation(api.attendance.recordManual, { employeeId: hourly, kind: "out", tzOffset: 0 });
    await t.run(async (ctx) => { const rec = (await ctx.db.query("attendance").collect())[0]; await ctx.db.patch(rec._id, { hoursWorked: 8 }); });
    const date = r1.date;
    await as.mutation(api.payroll.processPayroll, { name: "Test", startDate: date, endDate: date, deductionRatePercent: 0 });
    const recs = await as.query(api.payroll.listRecords, {});
    expect(recs.find((x) => x.employeeName === "Juma")!.grossPay).toBe(8000);
    expect(recs.find((x) => x.employeeName === "Asha")!.grossPay).toBe(300000 * (1 - 0)); // monthly: full period, no unpaid leave
    void emp;
  });

  it("rejects overlapping leave and lets a manager decide", async () => {
    const { as, emp } = await setup();
    const id = await as.mutation(api.hr.requestLeave, { employeeId: emp, leaveType: "annual", startDate: "2026-05-01", endDate: "2026-05-05" });
    await expect(as.mutation(api.hr.requestLeave, { employeeId: emp, leaveType: "sick", startDate: "2026-05-03", endDate: "2026-05-04" })).rejects.toThrow(/likizo nyingine/);
    await as.mutation(api.hr.decideLeave, { id, approve: true });
    const [l] = await as.query(api.hr.listLeave, {});
    expect([l.status, l.days]).toEqual(["approved", 5]);
    const ov = await as.query(api.hr.overview, { date: "2026-05-02" });
    expect(ov.onLeave).toBe(1);
  });
});

/* ───── biometric (WebAuthn) ───── */
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s: string) => new TextEncoder().encode(s);
function rawToDer(raw: Uint8Array) {
  const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let x = b.slice(i); if (x[0] & 0x80) x = new Uint8Array([0, ...x]); return [0x02, x.length, ...x]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}
async function assertion(key: CryptoKeyPair, challenge: string, opts: { counter: number; flags?: number; host?: string }) {
  const host = opts.host ?? "localhost";
  const rp = new Uint8Array(await crypto.subtle.digest("SHA-256", enc(host)));
  const authData = new Uint8Array([...rp, opts.flags ?? 0x05, 0, 0, 0, opts.counter]);
  const clientDataJSON = enc(JSON.stringify({ type: "webauthn.get", challenge, origin: `http://${host}:5173` }));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
  const signed = new Uint8Array([...authData, ...hash]);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, signed));
  return { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(rawToDer(raw)) };
}

describe("fingerprint / face sign-in (WebAuthn)", () => {
  it("enrolls an employee and verifies signed assertions, rejecting forgeries and replays", async () => {
    const { as, emp } = await setup();
    const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", key.publicKey));
    const reg = await as.mutation(api.biometric.registerOptions, { employeeId: emp });
    await as.mutation(api.biometric.finishRegistration, { employeeId: emp, challenge: reg.challenge, credentialId: "cred-1", publicKey: b64u(spki), algorithm: -7, clientDataJSON: b64u(enc(JSON.stringify({ type: "webauthn.create", challenge: reg.challenge, origin: "http://localhost:5173" }))) });
    expect(await as.query(api.biometric.listCredentials, {})).toHaveLength(1);

    const c1 = (await as.mutation(api.biometric.authOptions, {})).challenge;
    const ok = await as.mutation(api.biometric.authenticate, { challenge: c1, credentialId: "cred-1", kind: "in", tzOffset: 0, ...(await assertion(key, c1, { counter: 1 })) });
    expect(ok.employeeName).toBe("Asha");

    // challenge cannot be reused
    await expect(as.mutation(api.biometric.authenticate, { challenge: c1, credentialId: "cred-1", kind: "out", tzOffset: 0, ...(await assertion(key, c1, { counter: 2 })) })).rejects.toThrow();
    // signature from a different key is refused
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const c2 = (await as.mutation(api.biometric.authOptions, {})).challenge;
    await expect(as.mutation(api.biometric.authenticate, { challenge: c2, credentialId: "cred-1", kind: "out", tzOffset: 0, ...(await assertion(other, c2, { counter: 2 })) })).rejects.toThrow(/umeshindikana/);
    // no biometric verification flag -> refused
    const c3 = (await as.mutation(api.biometric.authOptions, {})).challenge;
    await expect(as.mutation(api.biometric.authenticate, { challenge: c3, credentialId: "cred-1", kind: "out", tzOffset: 0, ...(await assertion(key, c3, { counter: 3, flags: 0x01 })) })).rejects.toThrow(/haikuthibitishwa/);
    // replayed (non-increasing) counter -> refused
    const c4 = (await as.mutation(api.biometric.authOptions, {})).challenge;
    await expect(as.mutation(api.biometric.authenticate, { challenge: c4, credentialId: "cred-1", kind: "out", tzOffset: 0, ...(await assertion(key, c4, { counter: 1 })) })).rejects.toThrow(/umekataliwa/);
    // good sign-out
    const c5 = (await as.mutation(api.biometric.authOptions, {})).challenge;
    const out = await as.mutation(api.biometric.authenticate, { challenge: c5, credentialId: "cred-1", kind: "out", tzOffset: 0, ...(await assertion(key, c5, { counter: 4 })) });
    expect(out.hoursWorked).toBeGreaterThanOrEqual(0);
  });
});

describe("notifications and support", () => {
  it("raises alerts, tracks read state and handles tickets", async () => {
    const { t, as, tenant } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("products", { tenantId: tenant, itemCode: "P1", name: "Sukari", openingQty: 0, currentQty: 2, sellingPrice: 1, reorderLevel: 5, isActive: true }); });
    await as.mutation(api.bills.create, { vendor: "Mwenye nyumba", category: "rent", billDate: "2026-01-01", dueDate: "2026-01-10", amount: 50000 });
    const feed = await as.query(api.notifications.feed, { today: "2026-02-01" });
    expect(feed.items.map((i) => i.code).sort()).toEqual(["bill_overdue", "low_stock"]);
    expect(feed.unread).toBe(2);
    await as.mutation(api.notifications.markRead, { keys: feed.items.map((i) => i.key) });
    expect((await as.query(api.notifications.feed, { today: "2026-02-01" })).unread).toBe(0);
    const id = await as.mutation(api.support.create, { subject: "Msaada", message: "Naomba msaada", category: "question" });
    await as.mutation(api.support.respond, { id, reply: "Karibu", close: true });
    const [tk] = await as.query(api.support.list, {});
    expect([tk.status, tk.reply]).toEqual(["closed", "Karibu"]);
  });
});
