import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";

const header = { name: "Shop Ltd", address: "Dar", phone: "0700", email: "a@b.c", taxId: "123", logoUrl: "", currencySymbol: "TSh", decimalPlaces: 0, department: "Bar", preparedBy: "Asha" };
const doc = {
  header,
  purchase: { _id: "p1", invoiceNo: "7", internalRef: "PUR-7", supplierInvoiceNo: "SUP-9", date: "2026-10-01", dueDate: "2026-10-31", subtotal: 5000, discount: 0, additionalCharges: 0, taxAmount: 0, total: 5000, amountPaid: 2000, outstanding: 3000, paymentStatus: "partial", status: "posted", notes: "", createdBy: "Asha" },
  supplier: { name: "Acme Traders", code: "S1", phone: "0711", email: "", address: "Arusha", taxId: "", contactPerson: "" },
  lines: [{ name: "Sugar", itemCode: "P1", unit: "Kg", qty: 10, unitCost: 500, discount: 0, total: 5000 }],
  payments: [{ date: "2026-10-02", method: "cash", reference: "R1", amount: 2000 }],
};
const data: Record<string, unknown> = {
  "purchaseReports:reportHeader": header,
  "purchaseReports:purchaseDocument": doc,
  "purchaseReports:supplierBalances": { header, rows: [{ supplierId: "s1", name: "Acme Traders", code: "S1", phone: "", opening: 1000, purchases: 5000, payments: 2000, returns: 0, closing: 4000 }] },
  "purchaseReports:supplierLedger": { header, supplier: { name: "Acme Traders", code: "S1", phone: "", email: "", address: "", taxId: "", paymentTerms: "30days", creditLimit: 0 }, opening: 1000, closing: 4000, totals: { charges: 5000, credits: 2000 }, rows: [{ date: "2026-10-01", type: "purchase", reference: "7", description: "Purchase invoice", charge: 5000, credit: 0, balance: 6000, purchaseId: "p1" }, { date: "2026-10-02", type: "payment", reference: "R1", description: "Payment", charge: 0, credit: 2000, balance: 4000 }] },
  "purchaseReports:payablesAgeing": { asOf: "2026-10-13", header, rows: [{ purchaseId: "p1", invoiceNo: "7", supplierId: "s1", supplierName: "Acme Traders", purchaseDate: "2026-08-01", dueDate: "2026-08-31", daysOverdue: 43, total: 5000, paid: 2000, outstanding: 3000 }] },
};
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: unknown) => (args === "skip" ? undefined : data[getFunctionName(ref)]),
  useMutation: () => vi.fn(), useAction: () => vi.fn(), useConvex: () => ({ query: vi.fn() }),
}));

import { setLang } from "@/lib/i18n.ts";
import PurchaseReports, { type Registers } from "./PurchaseReports.tsx";
import PurchaseDocument from "@/components/PurchaseDocument.tsx";

const reg = {
  suppliers: [{ _id: "s1", name: "Acme Traders", isActive: true }],
  purchases: [
    { _id: "p1", invoiceNo: "7", internalRef: "PUR-7", supplierId: "s1", purchaseDate: "2026-10-01", total: 5000, amountPaid: 2000, outstanding: 3000, paymentStatus: "partial", status: "posted" },
    { _id: "p2", invoiceNo: "8", internalRef: "PUR-8", supplierId: "s1", purchaseDate: "2026-09-01", total: 1000, amountPaid: 0, outstanding: 1000, paymentStatus: "unpaid", status: "cancelled" },
  ],
  payments: [{ _id: "pay1", paymentDate: "2026-10-02", supplierId: "s1", amount: 2000, paymentMethod: "cash", reference: "R1" }],
  returns: [], orders: [], grns: [], products: [], orderLines: [],
  lines: [{ purchaseId: "p1", invoiceNo: "7", date: "2026-10-01", supplierId: "s1", supplierName: "Acme Traders", productId: "x", productName: "Sugar", unit: "Kg", qty: 10, unitCost: 500, total: 5000 }],
  totals: { purchase: 5000, paid: 2000, outstanding: 3000, returns: 0, paymentTotal: 2000 },
} as unknown as Registers;

const show = (path: string) => render(<PurchaseReports path={`reports/${path}`} startDate="2026-10-01" endDate="2026-10-31" data={reg} />);

describe("professional purchasing reports", () => {
  // The system speaks one language at a time (Kiswahili by default); assert on the English texts here.
  beforeAll(() => { setLang("en", { reload: false }); });
  afterAll(() => { setLang("sw", { reload: false }); });

  it("renders every report with the business letterhead and its figures", () => {
    for (const [path, text] of [["invoices", "PUR-7"], ["summary", "Monthly trend"], ["analysis", "Top 5 suppliers"], ["by-supplier", "Acme Traders"], ["by-product", "Sugar"], ["payments", "R1"], ["outstanding", "Ageing by supplier"], ["last-price", "Sugar"], ["supplier-statement", "Acme Traders"]] as const) {
      const { unmount } = show(path);
      expect(screen.getAllByText("Shop Ltd").length, path).toBeGreaterThan(0);
      expect(screen.getAllByText(new RegExp(text.replace("PUR-7", "7"))).length, path).toBeGreaterThan(0);
      unmount();
    }
  });

  it("invoice list excludes cancelled invoices from the totals and can open the document", () => {
    show("invoices");
    expect(screen.getAllByText("5,000").length).toBeGreaterThan(0);
    expect(screen.queryByText("6,000")).toBeNull(); // 5,000 + 1,000 would mean the cancelled invoice was counted
    fireEvent.click(screen.getAllByRole("button", { name: /Open/ })[0]);
    expect(screen.getByText(/Purchase Invoice #7/)).toBeTruthy();
  });

  it("purchase document shows the status, supplier, items and payment receipt", () => {
    render(<PurchaseDocument purchaseId={"p1" as never} />);
    expect(screen.getByText(/Purchase Invoice #7/)).toBeTruthy();
    expect(screen.getByText("Partially paid")).toBeTruthy();
    expect(screen.getAllByText("Acme Traders").length).toBeGreaterThan(1);
    expect(screen.getByText("Sugar")).toBeTruthy();
    expect(screen.getByText("Payment Receipt")).toBeTruthy();
  });
});
