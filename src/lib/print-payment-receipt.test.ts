import { describe, expect, it } from "vitest";
import { paymentReceiptHtml } from "./print-payment-receipt.ts";

describe("payment receipt", () => {
  const base = { receiptNo: "A1B2C3", cashierName: "Neema", payments: [{ method: "Cash", amount: 3000 }, { method: "M-Pesa", amount: 1000 }], total: 4000 };

  it("shows the total, who received it and every payment method", () => {
    const html = paymentReceiptHtml({ ...base, fromName: "Juma", orders: [{ label: "10:00 · 5", amount: 4000 }] }, "80mm", { companyName: "Rudy Bar" });
    expect(html).toContain("RUDY BAR");
    expect(html).toContain("A1B2C3");
    expect(html).toContain("Neema");
    expect(html).toContain("Juma");
    expect(html).toContain("Cash");
    expect(html).toContain("M-Pesa");
    expect(html).toContain("4,000/=");
  });

  it("a counter sale lists the sold items", () => {
    const html = paymentReceiptHtml({ ...base, items: [{ name: "Bia", qty: 2, amount: 4000 }] });
    expect(html).toContain("Bia");
  });

  it("escapes text coming from users", () => {
    const html = paymentReceiptHtml({ ...base, fromName: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses the paper width", () => {
    expect(paymentReceiptHtml(base, "58mm")).toContain("size:58mm");
    expect(paymentReceiptHtml(base, "A4")).toContain("size:190mm");
  });
});
