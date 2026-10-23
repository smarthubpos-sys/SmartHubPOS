// Drives the real Excel import page: file choice -> preview -> import -> result report.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import ExcelJS from "exceljs";

const { importBatch, toast } = vi.hoisted(() => ({ importBatch: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("sonner", () => ({ toast }));
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => (getFunctionName(ref) === "products:listGroups" || getFunctionName(ref) === "products:listUnits" ? [] : undefined),
  useMutation: () => importBatch,
}));
vi.mock("@/hooks/use-stock-rights.ts", () => ({ useStockRights: () => ({ canAdjust: true }) }));

import StockImport from "./StockImport.tsx";

const HEAD = ["Jina la bidhaa *", "Msimbo wa bidhaa", "Barcode", "Kundi", "Kipimo", "Bei ya kuuzia *", "Bei ya manunuzi", "Idadi"];
async function xlsx(name: string, rows: unknown[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Bidhaa"); ws.addRow(HEAD); rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return { name, size: (buf as ArrayBuffer).byteLength, arrayBuffer: async () => buf } as unknown as File;
}
const choose = (file: File) => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
const show = () => render(<MemoryRouter><StockImport /></MemoryRouter>);
// the server echoes one result per row: errors for names starting with "BAD"
const serverEcho = (failAtSave: (name: string) => boolean) => async (args: { rows: { name: string }[]; dryRun: boolean }) => {
  const results = args.rows.map((r, row) => (!args.dryRun && failAtSave(r.name) ? { row, status: "error" as const, message: "Bidhaa tayari ipo (kuboresha zilizopo kumezimwa)." } : { row, status: "new" as const, itemCode: `ITM-${row}` }));
  return { results, created: results.filter((r) => r.status === "new").length, updated: 0, errors: results.filter((r) => r.status === "error").length };
};

describe("Excel import page", () => {
  beforeEach(() => { importBatch.mockReset(); Object.values(toast).forEach((f) => f.mockReset()); });

  it("rejects an unsupported file type and never calls the server", async () => {
    show();
    choose({ name: "bidhaa.csv", size: 10, arrayBuffer: async () => new ArrayBuffer(10) } as unknown as File);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/\.xlsx/);
    expect(importBatch).not.toHaveBeenCalled();
  });

  it("reports a missing required header by name", async () => {
    show();
    const wb = new ExcelJS.Workbook(); wb.addWorksheet("a").addRow(["Jina la bidhaa", "Idadi"]);
    const buf = await wb.xlsx.writeBuffer();
    choose({ name: "x.xlsx", size: 100, arrayBuffer: async () => buf } as unknown as File);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("Bei ya kuuzia");
    expect(importBatch).not.toHaveBeenCalled();
  });

  it("previews valid and invalid rows, then imports only the valid ones and reports the outcome", async () => {
    importBatch.mockImplementation(serverEcho(() => false));
    show();
    choose(await xlsx("ok.xlsx", [["Sukari", "", "", "", "", 3000, 2400, 5], [], ["Hakuna bei"], ["Mafuta", "", "", "", "", 5000]]));
    await screen.findByText("Sukari");
    expect(screen.getByText("Hakuna bei")).toBeInTheDocument(); // the invalid row is shown, not hidden
    expect(importBatch).toHaveBeenCalledTimes(1);               // preview only sent the 2 valid rows (dry run)
    expect(importBatch.mock.calls[0][0]).toMatchObject({ dryRun: true });
    expect(importBatch.mock.calls[0][0].rows).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Ingiza bidhaa 2/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled()); // finished WITH 1 skipped row -> a warning, not a plain success
    expect(importBatch.mock.calls[1][0]).toMatchObject({ dryRun: false });
    // Regression: the import must send the product objects (not the server's row indexes) - this is what broke every upload.
    expect(importBatch.mock.calls[1][0].rows).toEqual([expect.objectContaining({ name: "Sukari", sellingPrice: 3000 }), expect.objectContaining({ name: "Mafuta", sellingPrice: 5000 })]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not claim success when the server refuses a row at save time, and lists that row", async () => {
    importBatch.mockImplementation(serverEcho((n) => n === "Mafuta"));
    show();
    choose(await xlsx("ok.xlsx", [["Sukari", "", "", "", "", 3000], ["Mafuta", "", "", "", "", 5000]]));
    await screen.findByText("Sukari");
    fireEvent.click(screen.getByRole("button", { name: /Ingiza bidhaa 2/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByText(/Safu 3: Mafuta/)).toBeInTheDocument();
  });

  it("when the import stops half-way it says so and lists what was not imported", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => [`Bidhaa ${i + 1}`, "", "", "", "", 100]);
    let saves = 0;
    importBatch.mockImplementation(async (args: { rows: { name: string }[]; dryRun: boolean }) => {
      if (!args.dryRun && ++saves === 2) throw new Error("Network down");
      return serverEcho(() => false)(args);
    });
    show();
    choose(await xlsx("big.xlsx", rows));
    await screen.findByText("Bidhaa 1");
    fireEvent.click(screen.getByRole("button", { name: /Ingiza bidhaa 450/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByText(/Uingizaji ulisimama/)).toBeInTheDocument();
    expect(screen.getByText(/Safu 402: Bidhaa 401/)).toBeInTheDocument(); // first row of the batch that never saved
  });

  it("flags a product repeated in two different 400-row batches before importing", async () => {
    const rows = Array.from({ length: 401 }, (_, i) => [`Bidhaa ${i + 1}`, "", "", "", "", 100]);
    rows[400] = ["bidhaa 1", "", "", "", "", 100]; // same name as row 2, lands in the second batch
    importBatch.mockImplementation(serverEcho(() => false));
    show();
    choose(await xlsx("dup.xlsx", rows));
    await screen.findByText("Bidhaa 1");
    const sent = importBatch.mock.calls.flatMap((c) => c[0].rows as unknown[]);
    expect(sent).toHaveLength(400); // the repeat never reached the server
    expect(screen.getByRole("button", { name: /Ingiza bidhaa 400/ })).toBeInTheDocument();
  });
});
