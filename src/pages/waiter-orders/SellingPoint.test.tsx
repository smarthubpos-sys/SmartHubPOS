import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";

const { submit, printWaiterOrder, toast } = vi.hoisted(() => ({
  submit: vi.fn(),
  printWaiterOrder: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));
let settings: Record<string, unknown> = {};

const data = (): Record<string, unknown> => ({
  "products:listActive": [{ _id: "p1", name: "Bia", sellingPrice: 2000, itemCode: "P1", groupId: "g1", isActive: true }],
  "products:listGroups": [{ _id: "g1", name: "Vinywaji", isActive: true }],
  "users:getCurrentUser": { name: "Juma", username: "juma", role: "waiter" },
  "maintenance:getSettings": { app: settings },
});
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: unknown) => (args === "skip" ? undefined : data()[getFunctionName(ref)]),
  useMutation: () => submit,
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/print-waiter-order.ts", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/print-waiter-order.ts")>()),
  printWaiterOrder,
}));

import SellingPoint from "@/pages/waiter-orders/SellingPoint.tsx";

const addBia = () => fireEvent.click(screen.getByRole("button", { name: /Bia/ }));
const cartHasBia = () => screen.queryByText(/2,000 × 1|2.000 × 1|2000 × 1/) !== null;

describe("Selling Point: Send and Print", () => {
  beforeEach(() => {
    submit.mockReset(); printWaiterOrder.mockReset();
    toast.success.mockReset(); toast.error.mockReset(); toast.message.mockReset();
    settings = { hardware: { printerSource: "installed", receiptPrinter: "XP-80", paperWidth: "80mm" } };
  });

  it("Send saves the order once with the right lines, clears the cart, and prints nothing", async () => {
    submit.mockResolvedValue({ orderId: "o1", status: "pending", duplicate: false });
    render(<SellingPoint />);
    addBia();
    expect(cartHasBia()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toMatchObject({ mode: "send", lines: [{ productId: "p1", qty: 1 }] });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(cartHasBia()).toBe(false);
    expect(printWaiterOrder).not.toHaveBeenCalled();
  });

  it("Print saves the order, then prints on the chosen QZ Tray printer with the slip's lines", async () => {
    submit.mockResolvedValue({ orderId: "o2", status: "printed", duplicate: false });
    printWaiterOrder.mockResolvedValue(true);
    render(<SellingPoint />);
    addBia();
    fireEvent.click(screen.getByRole("button", { name: /^(Print|Chapisha)$/ }));
    await waitFor(() => expect(printWaiterOrder).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toMatchObject({ mode: "print" });
    const [order, printer, width] = printWaiterOrder.mock.calls[0];
    expect(order).toMatchObject({ total: 2000, lines: [{ productName: "Bia", qty: 1, lineTotal: 2000 }] });
    expect(printer).toBe("XP-80");
    expect(width).toBe("80mm");
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("when the printer fails the order stays saved (stock already deducted) and the person is told to reprint from Bills - no second submit", async () => {
    submit.mockResolvedValue({ orderId: "o3", status: "printed", duplicate: false });
    printWaiterOrder.mockResolvedValue(false);
    render(<SellingPoint />);
    addBia();
    fireEvent.click(screen.getByRole("button", { name: /^(Print|Chapisha)$/ }));
    await waitFor(() => expect(toast.message).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a repeated/duplicate answer never prints a second slip", async () => {
    submit.mockResolvedValue({ orderId: "o4", status: "printed", duplicate: true });
    render(<SellingPoint />);
    addBia();
    fireEvent.click(screen.getByRole("button", { name: /^(Print|Chapisha)$/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(printWaiterOrder).not.toHaveBeenCalled();
  });

  it("a server refusal shows the REAL reason and keeps the cart so nothing is lost", async () => {
    submit.mockRejectedValue(new ConvexError("Stock haitoshi kwa Bia. Iliyopo: 0, unayouza: 1"));
    render(<SellingPoint />);
    addBia();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("Stock haitoshi kwa Bia");
    expect(cartHasBia()).toBe(true);
    expect(printWaiterOrder).not.toHaveBeenCalled();
  });

  it("a server that does not have the function yet (stale deployment) is named in the message, not hidden behind a generic one", async () => {
    submit.mockRejectedValue(new Error("[CONVEX M(waiterOrders:submit)] [Request ID: x] Server Error Could not find public function for 'waiterOrders:submit'. Did you forget to run `npx convex deploy`?"));
    render(<SellingPoint />);
    addBia();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("waiterOrders:submit");
    expect(cartHasBia()).toBe(true);
  });

  it("uses the saved printer even when printerSource was never stored (cashier regression)", async () => {
    settings = { hardware: { receiptPrinter: "XP-80", paperWidth: "80mm" } };
    submit.mockResolvedValue({ orderId: "o9", status: "printed", duplicate: false });
    printWaiterOrder.mockResolvedValue(true);
    render(<SellingPoint />);
    addBia();
    fireEvent.click(screen.getByRole("button", { name: /^(Print|Chapisha)$/ }));
    await waitFor(() => expect(printWaiterOrder).toHaveBeenCalledTimes(1));
    expect(printWaiterOrder.mock.calls[0][1]).toBe("XP-80");
  });
});
