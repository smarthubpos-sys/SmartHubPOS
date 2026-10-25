import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { printHtmlViaQz } from "./printers.ts";
import { printWaiterOrder, qzPrinterFrom } from "./print-waiter-order.ts";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("./i18n.ts", () => ({ tr: (value: string) => value }));
vi.mock("./printers.ts", () => ({ printHtmlViaQz: vi.fn() }));

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
    expect(printHtmlViaQz).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("sends a fixed-layout receipt to the selected QZ printer", async () => {
    vi.mocked(printHtmlViaQz).mockResolvedValue(undefined);
    await expect(printWaiterOrder(order, "Receipt Printer", "58mm")).resolves.toBe(true);
    expect(printHtmlViaQz).toHaveBeenCalledTimes(1);
    const [printer, html] = vi.mocked(printHtmlViaQz).mock.calls[0];
    expect(printer).toBe("Receipt Printer");
    expect(html).toContain("table-layout:fixed");
    expect(html).toContain("Jina refu la bidhaa");
    expect(html).toContain("58mm");
  });

  it("reports QZ Tray failures and never reports the order as printed", async () => {
    vi.mocked(printHtmlViaQz).mockRejectedValue(new Error("QZ disconnected"));
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

