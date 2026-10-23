import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";

const mutations: Record<string, ReturnType<typeof vi.fn>> = {};
let editable: Record<string, unknown> | null = null;
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => {
    const name = getFunctionName(ref);
    if (name === "tenants:getEditable") return editable;
    if (name === "tenants:listBranches") return [];
    return undefined;
  },
  useMutation: (ref: never) => (mutations[getFunctionName(ref)] ??= vi.fn().mockResolvedValue(null)),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import EditBusinessPanel from "./EditBusinessPanel.tsx";
import { tr } from "@/lib/i18n.ts";

// jsdom has no ResizeObserver, which the Radix Switch needs.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const base = { name: "Bar", code: "BAR", currency: "TZS", modules: null, allModules: [] as string[] };
const show = () => render(<EditBusinessPanel tenantId={"t1" as never} />);
const waiter = () => screen.getByRole("switch", { name: tr("Enable Waiter") });
const waitress = () => screen.getByRole("switch", { name: tr("Enable Waitress") });

describe("Edit Business: Waiter / Waitress switches", () => {
  beforeEach(() => { for (const k of Object.keys(mutations)) delete mutations[k]; });

  it("shows two separate switches with the saved values", () => {
    editable = { ...base, waiterEnabled: true, waitressEnabled: false, waiterOrderMode: "cashier" };
    show();
    expect(waiter()).toHaveAttribute("aria-checked", "true");
    expect(waitress()).toHaveAttribute("aria-checked", "false");
  });

  it("an existing business with no saved values shows both OFF", () => {
    editable = { ...base };
    show();
    expect(waiter()).toHaveAttribute("aria-checked", "false");
    expect(waitress()).toHaveAttribute("aria-checked", "false");
  });

  it("changing one does not change the other, and Save sends both", async () => {
    editable = { ...base, waiterEnabled: false, waitressEnabled: false, waiterOrderMode: "cashier" };
    show();
    fireEvent.click(waitress());
    expect(waitress()).toHaveAttribute("aria-checked", "true");
    expect(waiter()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(waiter());
    fireEvent.click(waitress());
    expect(waiter()).toHaveAttribute("aria-checked", "true");
    expect(waitress()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: /Hifadhi mabadiliko/ }));
    await waitFor(() => expect(mutations["tenants:update"]).toHaveBeenCalled());
    expect(mutations["tenants:update"]).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", name: "Bar", code: "BAR", currency: "TZS", waiterEnabled: true, waitressEnabled: false }));
  });

  it("saving without touching the switches re-sends the persisted values (nothing resets)", async () => {
    editable = { ...base, waiterEnabled: false, waitressEnabled: true, waiterOrderMode: "print" };
    show();
    fireEvent.change(screen.getByDisplayValue("Bar"), { target: { value: "Bar Mpya" } });
    fireEvent.click(screen.getByRole("button", { name: /Hifadhi mabadiliko/ }));
    await waitFor(() => expect(mutations["tenants:update"]).toHaveBeenCalled());
    expect(mutations["tenants:update"]).toHaveBeenCalledWith(expect.objectContaining({ name: "Bar Mpya", waiterEnabled: false, waitressEnabled: true, waiterOrderMode: "print" }));
  });
});
