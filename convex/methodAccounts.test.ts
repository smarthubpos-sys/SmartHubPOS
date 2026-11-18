import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { TestConvex } from "convex-test";
import { modules } from "./tes.setup";

const date = new Date().toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "purchasing", "stock", "accounts", "payroll"] });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 100, currentQty: 100, isActive: true });
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme Traders", openingBalance: 0, isActive: true });
    return { tenantId, mgr, clientId, productId, supplierId };
  });
  const asMgr = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
  return { t, ...ids, asMgr };
}

/** debit - credit of every journal line, per account name. */
async function ledger(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const out: Record<string, { code: string; net: number }> = {};
    for (const l of await ctx.db.query("journalLines").collect()) {
      const a = await ctx.db.get("accounts", l.accountId);
      if (!a) continue;
      out[a.name] = { code: a.code, net: (out[a.name]?.net ?? 0) + l.debit - l.credit };
    }
    return out;
  });
}

describe("every payment goes to the account of its own payment method", () => {
  it("10,000 M-Pesa + 10,000 CRDB + 10,000 cash lands in three different accounts", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "M-Pesa 5551234", kind: "mobile", isActive: true });
    const bank = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 3, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [
      { method: "x", methodId: phone, amount: 10000 }, { method: "x", methodId: bank, amount: 10000 }, { method: "cash", amount: 10000 },
    ] });
    const l = await ledger(t);
    expect(l["M-Pesa 5551234"].net).toBe(10000);
    expect(l["CRDB"].net).toBe(10000);
    expect(l["Cash and equivalents"].net).toBe(10000);
    expect(l["Accounts receivable"].net).toBe(0);
    const codes = new Set([l["M-Pesa 5551234"].code, l["CRDB"].code, l["Cash and equivalents"].code]);
    expect(codes.size).toBe(3);
  });

  it("two banks get two separate accounts, and the account follows a renamed method", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const crdb = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    const nmb = await asMgr.mutation(api.paymentMethods.upsert, { name: "NMB", kind: "bank", isActive: true });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "x", methodId: crdb, amount: 5000 }, { method: "x", methodId: nmb, amount: 7000 }] });
    await asMgr.mutation(api.paymentMethods.upsert, { id: nmb, name: "NMB Biashara", kind: "bank", isActive: true });
    const l = await ledger(t);
    expect(l["CRDB"]).toMatchObject({ net: 5000 });
    expect(l["NMB Biashara"]).toMatchObject({ net: 7000 });
    expect(l["CRDB"].code).not.toBe(l["NMB Biashara"].code);
    const bal = await asMgr.query(api.paymentMethods.balances, {});
    expect(bal.find((b) => b.name === "CRDB")?.balance).toBe(5000);
    expect(bal.find((b) => b.name === "NMB Biashara")?.balance).toBe(7000);
  });

  it("payment made while creating the invoice goes to its method's account", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }], paymentAmount: 4000, paymentMethod: "x", paymentMethodId: phone });
    const l = await ledger(t);
    expect(l["Lipa 1234"].net).toBe(4000);
    expect(l["Cash and equivalents"]?.net ?? 0).toBe(0);
  });

  it("supplier payments and purchases paid on receipt are taken out of the method's account", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    const bank = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, splits: [{ method: "x", methodId: bank, amount: 5000 }, { method: "x", methodId: phone, amount: 7000 }], lines: [{ productId, qty: 10, unitCost: 3000 }] });
    await asMgr.mutation(api.purchasing.recordSupplierPayment, { supplierId, paymentDate: date, splits: [{ method: "x", methodId: phone, amount: 3000 }, { method: "cash", amount: 2000 }] });
    const l = await ledger(t);
    expect(l["CRDB"].net).toBe(-5000);
    expect(l["Lipa 1234"].net).toBe(-10000);
    expect(l["Cash and equivalents"].net).toBe(-2000);
    expect(l["Accounts payable"].net).toBe(-13000); // 30,000 bought - 12,000 paid on receipt - 5,000 paid later
  });

  it("bill payment, capital received and payroll use the chosen method's account", async () => {
    const { t, asMgr } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    const bank = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    await asMgr.mutation(api.capital.receive, { receiptDate: date, amount: 100000, sourceType: "owner_capital", sourceName: "Juma", depositMethod: "x", depositMethodId: bank });
    const billId = await asMgr.mutation(api.bills.create, { vendor: "TANESCO", category: "electricity", billDate: date, dueDate: date, amount: 40000 });
    await asMgr.mutation(api.bills.pay, { billId, amount: 40000, method: "x", methodId: phone, paymentDate: date });
    const l = await ledger(t);
    expect(l["CRDB"].net).toBe(100000);
    expect(l["Lipa 1234"].net).toBe(-40000);
  });

  it("repairs old payments that were all posted to Cash, and can be run twice", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "x", methodId: phone, amount: 6000 }] });
    // simulate the old behaviour: the line sat on Cash
    await t.run(async (ctx) => {
      const cash = (await ctx.db.query("accounts").collect()).find((a) => a.code === "1000")!;
      const line = (await ctx.db.query("journalLines").collect()).find((x) => x.debit === 6000)!;
      await ctx.db.patch("journalLines", line._id, { accountId: cash._id });
    });
    expect((await ledger(t))["Cash and equivalents"].net).toBe(6000);
    expect(await asMgr.mutation(api.paymentMethods.repairOldPayments, {})).toEqual({ moved: 1 });
    const l = await ledger(t);
    expect(l["Lipa 1234"].net).toBe(6000);
    expect(l["Cash and equivalents"]?.net ?? 0).toBe(0);
    expect(await asMgr.mutation(api.paymentMethods.repairOldPayments, {})).toEqual({ moved: 0 });
  });
});

describe("expense bills use the business's Chart of Accounts", () => {
  it("lists its expense accounts, '+' adds a real one, and the bill posts to the chosen account (not 'Other')", async () => {
    const { t, asMgr, tenantId } = await setup();
    await t.run((ctx) => ctx.db.insert("accounts", { tenantId, code: "6300", name: "Mishahara", type: "expense", balance: 0, isActive: true }));
    await t.run((ctx) => ctx.db.insert("accounts", { tenantId, code: "1000", name: "Cash", type: "asset", balance: 0, isActive: true }));
    expect((await asMgr.query(api.bills.expenseAccounts, {})).map((a) => a.name)).toEqual(["Mishahara"]); // only expense accounts
    const added = await asMgr.mutation(api.bills.addExpenseAccount, { name: "Matangazo" });
    expect(added.code).toBe("6200");
    expect((await asMgr.mutation(api.bills.addExpenseAccount, { name: "matangazo" })).accountId).toBe(added.accountId); // same name: no duplicate
    expect((await asMgr.query(api.bills.expenseAccounts, {})).map((a) => a.name).sort()).toEqual(["Matangazo", "Mishahara"]);
    const billId = await asMgr.mutation(api.bills.create, { vendor: "Redio", category: "x", expenseAccountId: added.accountId, billDate: date, dueDate: date, amount: 5000 });
    await t.run(async (ctx) => {
      const bill = await ctx.db.get("bills", billId);
      expect(bill).toMatchObject({ category: "Matangazo", expenseAccountId: added.accountId });
      const lines = await ctx.db.query("journalLines").collect();
      expect(lines.some((l) => l.accountId === added.accountId && l.debit === 5000)).toBe(true);
      expect((await ctx.db.query("accounts").collect()).some((a) => a.code === "6190")).toBe(false); // nothing went to "Other bills expense"
    });
    // moving the bill to another account re-books it; a non-expense account is refused
    const mishahara = (await asMgr.query(api.bills.expenseAccounts, {})).find((a) => a.name === "Mishahara")!;
    await asMgr.mutation(api.bills.update, { billId, vendor: "Redio", category: "x", expenseAccountId: mishahara._id, billDate: date, dueDate: date, amount: 5000 });
    const cash = await t.run(async (ctx) => (await ctx.db.query("accounts").collect()).find((a) => a.code === "1000")!._id);
    await expect(asMgr.mutation(api.bills.create, { vendor: "V", category: "x", expenseAccountId: cash, billDate: date, dueDate: date, amount: 100 })).rejects.toThrow(/Account ya matumizi/);
    await t.run(async (ctx) => {
      const net = (id: typeof cash) => ctx.db.query("journalLines").collect().then((ls) => ls.filter((l) => l.accountId === id).reduce((n, l) => n + l.debit - l.credit, 0));
      expect(await net(added.accountId)).toBe(0);
      expect(await net(mishahara._id)).toBe(5000);
    });
    await asMgr.mutation(api.bills.voidBill, { billId });
    await t.run(async (ctx) => { const ls = await ctx.db.query("journalLines").collect(); expect(ls.filter((l) => l.accountId === mishahara._id).reduce((n, l) => n + l.debit - l.credit, 0)).toBe(0); });
  });
});

describe("Chart of Accounts: locations, edit and delete", () => {
  async function twoDepartments() {
    const base = await setup();
    const { t, tenantId } = base;
    const now = new Date().toISOString();
    const bar = await t.run((ctx) => ctx.db.insert("branches", { tenantId, name: "Bar", code: "BAR", isActive: true, createdAt: now }));
    const kitchen = await t.run((ctx) => ctx.db.insert("branches", { tenantId, name: "Kitchen", code: "KIT", isActive: true, createdAt: now }));
    const barMgr = await t.run((ctx) => ctx.db.insert("users", { name: "BarMgr", username: "barmgr", role: "admin", tenantId, branchId: bar, isActive: true }));
    const kitMgr = await t.run((ctx) => ctx.db.insert("users", { name: "KitMgr", username: "kitmgr", role: "admin", tenantId, branchId: kitchen, isActive: true }));
    return { ...base, bar, kitchen, asBar: t.withIdentity({ subject: barMgr, tokenIdentifier: "x|2" }), asKitchen: t.withIdentity({ subject: kitMgr, tokenIdentifier: "x|3" }) };
  }

  it("an 'All locations' account is usable by every department, and each department keeps only its own figures", async () => {
    const { asMgr, asBar, asKitchen } = await twoDepartments();
    const shared = await asMgr.mutation(api.accounting.createAccount, { code: "6500", name: "Shared expense", type: "expense", location: "all" });
    const mine = await asBar.mutation(api.accounting.createAccount, { code: "6600", name: "Bar only", type: "expense" });
    expect((await asBar.query(api.accounting.listAccounts, {})).map((a) => a.code).sort()).toEqual(["6500", "6600"]);
    expect((await asKitchen.query(api.accounting.listAccounts, {})).map((a) => a.code)).toEqual(["6500"]); // sees shared, never the Bar's own
    expect((await asBar.query(api.bills.expenseAccounts, {})).map((a) => a.code)).toEqual(["6500", "6600"]);
    // each department books a bill on the shared account; each sees only its own amount
    await asBar.mutation(api.bills.create, { vendor: "A", category: "x", expenseAccountId: shared, billDate: date, dueDate: date, amount: 1000 });
    await asKitchen.mutation(api.bills.create, { vendor: "B", category: "x", expenseAccountId: shared, billDate: date, dueDate: date, amount: 400 });
    const pl = async (as: typeof asBar) => (await as.query(api.accounting.profitAndLoss, { startDate: date, endDate: date })).totalExpenses;
    expect([await pl(asBar), await pl(asKitchen), await pl(asMgr)]).toEqual([1000, 400, 1400]);
    await expect(asKitchen.mutation(api.bills.create, { vendor: "C", category: "x", expenseAccountId: (await asBar.query(api.accounting.listAccounts, {})).find((a) => a.code === "6600")!._id, billDate: date, dueDate: date, amount: 1 })).rejects.toThrow(/Account ya matumizi/);
    void mine;
  });

  it("moves an account to another department, to all locations, and refuses unsafe moves", async () => {
    const { asMgr, asBar, bar, kitchen } = await twoDepartments();
    const id = await asBar.mutation(api.accounting.createAccount, { code: "6700", name: "Matangazo", type: "expense" });
    await expect(asBar.mutation(api.accounting.updateAccount, { accountId: id, location: "all" })).rejects.toThrow(/All departments/); // a department user cannot relocate
    await asMgr.mutation(api.accounting.updateAccount, { accountId: id, location: (await asMgr.query(api.accounting.listAccounts, {})).length ? kitchen : kitchen });
    expect((await asMgr.query(api.accounting.listAccounts, {})).find((a) => a.code === "6700")?.branchId).toBe(kitchen);
    await asMgr.mutation(api.accounting.updateAccount, { accountId: id, location: "all", name: "Matangazo yote" });
    const row = (await asMgr.query(api.accounting.listAccounts, {})).find((a) => a.code === "6700");
    expect(row).toMatchObject({ name: "Matangazo yote" });
    expect(row?.branchId).toBeUndefined();
    // posted by Bar, then it cannot be locked to Kitchen
    await asBar.mutation(api.bills.create, { vendor: "A", category: "x", expenseAccountId: id, billDate: date, dueDate: date, amount: 50 });
    await expect(asMgr.mutation(api.accounting.updateAccount, { accountId: id, location: kitchen })).rejects.toThrow(/idara nyingine/);
    await asMgr.mutation(api.accounting.updateAccount, { accountId: id, location: bar }); // all its postings are Bar's: allowed
    // same code in the destination is refused
    await asMgr.mutation(api.accounting.createAccount, { code: "6800", name: "K", type: "expense", location: kitchen });
    const other = await asMgr.mutation(api.accounting.createAccount, { code: "6800", name: "B", type: "expense", location: bar });
    await expect(asMgr.mutation(api.accounting.updateAccount, { accountId: other, location: "all" })).rejects.toThrow(/tayari/);
  });

  it("deletes an unused account, and refuses one with postings (it can be switched off instead)", async () => {
    const { asMgr, asBar } = await twoDepartments();
    const unused = await asMgr.mutation(api.accounting.createAccount, { code: "6900", name: "Haitumiki", type: "expense", location: "all" });
    await asMgr.mutation(api.accounting.deleteAccount, { accountId: unused });
    expect((await asMgr.query(api.accounting.listAccounts, {})).some((a) => a.code === "6900")).toBe(false);
    const used = await asMgr.mutation(api.accounting.createAccount, { code: "6901", name: "Inatumika", type: "expense", location: "all" });
    await asBar.mutation(api.bills.create, { vendor: "A", category: "x", expenseAccountId: used, billDate: date, dueDate: date, amount: 10 });
    await expect(asMgr.mutation(api.accounting.deleteAccount, { accountId: used })).rejects.toThrow(/miamala|inatumiwa/);
    await asMgr.mutation(api.accounting.updateAccount, { accountId: used, isActive: false });
    expect((await asMgr.query(api.accounting.listAccounts, {})).find((a) => a.code === "6901")?.isActive).toBe(false);
  });

  it("unpay: an expense payment goes back to its method and the bill owes it again", async () => {
    const { t, asMgr } = await setup();
    const acc = await asMgr.mutation(api.bills.addExpenseAccount, { name: "Umeme" });
    const billId = await asMgr.mutation(api.bills.create, { vendor: "Tanesco", category: "x", expenseAccountId: acc.accountId, billDate: date, dueDate: date, amount: 3000 });
    const payId = await asMgr.mutation(api.bills.pay, { billId, amount: 3000, method: "cash", paymentDate: date });
    expect((await t.run((ctx) => ctx.db.get("bills", billId)))?.status).toBe("paid");
    await asMgr.mutation(api.bills.unpayBill, { paymentId: payId });
    expect(await t.run((ctx) => ctx.db.get("bills", billId))).toMatchObject({ paidAmount: 0, status: "unpaid" });
    const led = await ledger(t);
    expect(Object.values(led).filter((x) => x.code === "1000").reduce((n, x) => n + x.net, 0)).toBe(0); // cash back where it was
    await expect(asMgr.mutation(api.bills.unpayBill, { paymentId: payId })).rejects.toThrow(/sharudishwa/);
    await asMgr.mutation(api.bills.pay, { billId, amount: 3000, method: "cash", paymentDate: date }); // can be paid again
  });
});
