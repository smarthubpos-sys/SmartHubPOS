import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { previewAndPrintViaQz } from "./printers.ts";
import { printWaiterOrder, qzPrinterFrom } from "./print-waiter-order.ts";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("./i18n.ts", () => ({ tr: (value: string) => value }));
vi.mock("./printers.ts", () => ({ previewAndPrintViaQz: vi.fn() }));

const order = {
  customerName: "Mteja",
  waiterName: "Asha",
  tableNumber: "4",
  total: 12000,
  lines: [{ productName: "Jina refu la bidhaa", qty: 2, lineTotal: 12000 }],
};

describe("waiter order QZ printing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not open browser printing when no QZ printer is configured", async () => {
    await expect(printWaiterOrder(order)).resolves.toBe(false);
    expect(previewAndPrintViaQz).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("sends a fixed-layout receipt to the selected QZ printer", async () => {
    vi.mocked(previewAndPrintViaQz).mockResolvedValue(true);
    await expect(printWaiterOrder(order, "Receipt Printer", "58mm")).resolves.toBe(true);
    expect(previewAndPrintViaQz).toHaveBeenCalledTimes(1);
    const [printer, html] = vi.mocked(previewAndPrintViaQz).mock.calls[0];
    expect(printer).toBe("Receipt Printer");
    expect(html).toContain("table-layout:fixed");
    expect(html).toContain("Jina refu la bidhaa");
    expect(html).toContain("58mm");
  });

  it("does not report an order as printed when the preview is closed", async () => {
    vi.mocked(previewAndPrintViaQz).mockResolvedValue(false);
    await expect(printWaiterOrder(order, "Receipt Printer", "80mm")).resolves.toBe(false);
  });

  it("prints logo, title, company, info rows, QTY/ITEM/AMOUNT, total, payment info and footer in the receipt layout", async () => {
    vi.mocked(previewAndPrintViaQz).mockResolvedValue(true);
    await printWaiterOrder(order, "Receipt Printer", "80mm", { title: "CUSTOMER'S BILL", companyName: "Rudy's Farm", phone: "0656403636", logoUrl: "data:image/png;base64,AAAA", footer: "The Barbecue Place", paymentInfo: ["Voda: 51068098"], billId: "261022006", openTime: "2026-10-22 13:17:05" });
    const html = vi.mocked(previewAndPrintViaQz).mock.calls[0][1] as string;
    for (const part of ["data:image/png;base64,AAAA", "CUSTOMER&#39;S BILL", "RUDY&#39;S FARM", "TEL : 0656403636", "261022006", "2026-10-22 13:17:05", "IDADI", "BIDHAA", "KIASI", "JUMLA INAYODAIWA", "12,000/=", "Voda: 51068098", "The Barbecue Place"]) expect(html, part).toContain(part);
    // professional header: company details on the LEFT, logo on the RIGHT (same flex row), document title underneath
    expect(html).toContain("class=\"head\"");
    expect(html.indexOf("RUDY&#39;S FARM")).toBeLessThan(html.indexOf("data:image/png"));
    expect(html.indexOf("data:image/png")).toBeLessThan(html.indexOf("CUSTOMER"));
    expect(html.indexOf("JUMLA INAYODAIWA")).toBeLessThan(html.indexOf("Voda: 51068098"));
    expect(html.indexOf("Voda: 51068098")).toBeLessThan(html.indexOf("The Barbecue Place"));
  });

  it("tells QZ Tray the real paper width so an order is never shrunk or printed on the wrong size", async () => {
    vi.mocked(previewAndPrintViaQz).mockResolvedValue(true);
    await printWaiterOrder(order, "Receipt Printer", "80mm");
    expect(vi.mocked(previewAndPrintViaQz).mock.calls[0][2]).toBe("80mm");
    const html = vi.mocked(previewAndPrintViaQz).mock.calls[0][1] as string;
    expect(html).toContain("width:80mm");
    expect(html).not.toContain("margin:0;width:100%");
  });

  it("reports QZ Tray failures and never reports the order as printed", async () => {
    vi.mocked(previewAndPrintViaQz).mockRejectedValue(new Error("QZ disconnected"));
    await expect(printWaiterOrder(order, "Receipt Printer")).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("QZ disconnected"));
  });
});

describe("qzPrinterFrom (cashier and waiter share one printer rule)", () => {
  it("uses the saved printer for installed or unset source", () => {
    expect(qzPrinterFrom({ printerSource: "installed", receiptPrinter: " POS-80 " })).toBe("POS-80");
    expect(qzPrinterFrom({ receiptPrinter: "POS-80" })).toBe("POS-80");
  });
  it("returns nothing for direct devices, blank names or missing settings", () => {
    expect(qzPrinterFrom({ printerSource: "direct", receiptPrinter: "POS-80" })).toBeUndefined();
    expect(qzPrinterFrom({ printerSource: "installed", receiptPrinter: "  " })).toBeUndefined();
    expect(qzPrinterFrom(undefined)).toBeUndefined();
  });
});

