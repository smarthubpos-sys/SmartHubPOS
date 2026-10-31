import { describe, expect, it } from "vitest";
import { billReceiptHtml, type PrintableBill } from "./print-bill.ts";
import { receiptScale } from "./receipt-layout.ts";

const labels = { openTime: "Muda wa kufungua", printTime: "Muda wa kuchapa", billNo: "Namba ya bili", waiter: "Mhudumu", customer: "Mteja", department: "Idara", qty: "IDADI", item: "BIDHAA", amount: "KIASI", discount: "Punguzo", tax: "Kodi", outstanding: "Deni lililobaki", notes: "Maelezo" };
const base: PrintableBill = {
  kind: "bill", heading: "BILI YA MTEJA", company: { name: "Rudy's Farm", phone: "0656403636", logoUrl: "data:image/png;base64,AAAA" },
  printedAt: new Date(2026, 9, 30, 3, 57, 48), billId: "261030001", cashier: "Husna Issa", customer: "Mkaka",
  lines: [{ qty: "1", name: "SODA", amount: "2,000" }], totalLabel: "JUMLA INAYODAIWA", total: "2,000", labels,
};

describe("customer bill / invoice printout", () => {
  it("uses the same large layout as the order slip and fills the paper width", () => {
    const html = billReceiptHtml(base, "80mm");
    expect(html).toContain("@page{size:80mm auto;margin:0}");
    expect(html).toContain("width:72mm");
    expect(html).toContain(`font:${receiptScale("80mm").base}px`);
    for (const part of ["RUDY&#39;S FARM", "TEL : 0656403636", "BILI YA MTEJA", "2026-10-30 03:57:48", "Husna Issa", "SODA", "2,000/=", "JUMLA INAYODAIWA"]) expect(html, part).toContain(part);
  });
  it("text size follows the paper chosen in Hardware Setup", () => {
    expect(receiptScale("58mm").base).toBeLessThan(receiptScale("80mm").base);
    expect(billReceiptHtml(base, "58mm")).toContain("size:58mm");
    expect(billReceiptHtml(base, "A4")).toContain("size:190mm");
  });
  it("a bill has signature lines, an invoice does not; paid and balance show only when paid", () => {
    expect(billReceiptHtml(base, "80mm")).toContain('class="sign"');
    const inv = billReceiptHtml({ ...base, kind: "invoice", heading: "Sales", paid: { label: "Imelipwa (Cash)", amount: "1,000", outstanding: "1,000" } }, "80mm");
    expect(inv).not.toContain('class="sign"');
    expect(inv).toContain("Imelipwa (Cash)");
    expect(inv).toContain("Deni lililobaki");
  });
  it("escapes customer-controlled text", () => {
    expect(billReceiptHtml({ ...base, customer: "<script>x</script>" }, "80mm")).not.toContain("<script>x");
  });
});
