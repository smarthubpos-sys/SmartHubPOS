import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import SearchSelect from "@/components/SearchSelect.tsx";
import { describeSplits, newSplitLine, splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";
import type { PayMethod } from "@/hooks/use-payment-methods.ts";

const methods: PayMethod[] = [
  { key: "m1", _id: "m1", name: "M-Pesa 5551234", label: "M-Pesa 5551234 — 5551234", kind: "mobile", accountNo: "5551234" },
  { key: "b1", _id: "b1", name: "CRDB", label: "CRDB", kind: "bank" },
  { key: "cash", name: "cash", label: "Cash", kind: "cash" },
];

describe("split payment lines", () => {
  it("one receipt of 30,000 shared over phone, bank and cash", () => {
    const lines: SplitLine[] = [
      { methodKey: "m1", amount: "10000", reference: "MP1" },
      { methodKey: "b1", amount: "10000", reference: "" },
      { methodKey: "cash", amount: "10000", reference: "" },
      { methodKey: "cash", amount: "", reference: "" },
    ];
    expect(splitsTotal(lines)).toBe(30000);
    expect(toSplits(lines, methods)).toEqual([
      { method: "M-Pesa 5551234", methodId: "m1", amount: 10000, reference: "MP1" },
      { method: "CRDB", methodId: "b1", amount: 10000, reference: undefined },
      { method: "cash", methodId: undefined, amount: 10000, reference: undefined },
    ]);
    expect(describeSplits(lines, methods)).toBe("M-Pesa 5551234 10,000 + CRDB 10,000 + Cash 10,000");
  });

  it("the form adds lines, fills the remaining debt and shows what is left", () => {
    function Host() {
      const [lines, setLines] = useState<SplitLine[]>([newSplitLine(methods, "10000")]);
      return <PaymentSplit methods={methods} lines={lines} onChange={setLines} due={30000} />;
    }
    render(<Host />);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    fireEvent.click(screen.getByText(/Ongeza njia ya malipo|Add payment method/));
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    // second line: fill the remaining 20,000
    fireEvent.click(screen.getAllByText(/Jaza kilichobaki|Fill remaining/)[1]);
    const amounts = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(amounts.map((i) => i.value)).toEqual(["10000", "20000"]);
  });
});

describe("SearchSelect (supplier by name)", () => {
  const options = [{ value: "1", label: "Acme Traders", hint: "S1" }, { value: "2", label: "Baraka Wholesale", hint: "S2 · 0711" }, { value: "3", label: "Zawadi Foods" }];
  it("filters while typing and picks with a click", () => {
    const onChange = vi.fn();
    render(<SearchSelect options={options} value="" onChange={onChange} />);
    const box = screen.getByRole("combobox");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "bara" } });
    expect(screen.queryByText("Acme Traders")).toBeNull();
    fireEvent.mouseDown(screen.getByText("Baraka Wholesale"));
    expect(onChange).toHaveBeenCalledWith("2");
  });
  it("also finds by code / phone and chooses with Enter", () => {
    const onChange = vi.fn();
    render(<SearchSelect options={options} value="" onChange={onChange} />);
    const box = screen.getByRole("combobox");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "0711" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("2");
  });
  it("says when nothing matches", () => {
    render(<SearchSelect options={options} value="" onChange={vi.fn()} />);
    const box = screen.getByRole("combobox");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "xyz" } });
    expect(screen.getByText(/Hakuna kinachofanana|Nothing matches|No match/)).toBeTruthy();
  });
});
