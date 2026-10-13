import type { PayMethod } from "@/hooks/use-payment-methods.ts";

/** One line of a receipt: how much came in through which method (a receipt can have many lines). */
export type SplitLine = { methodKey: string; amount: string; reference: string };

export const n = (s: string) => { const x = Number(s); return Number.isFinite(x) ? x : 0; };
export const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const newSplitLine = (methods: PayMethod[], amount = ""): SplitLine => ({ methodKey: methods[0]?.key ?? "", amount, reference: "" });
export const splitsTotal = (lines: SplitLine[]) => Math.round(lines.reduce((s, l) => s + Math.max(0, n(l.amount)), 0) * 100) / 100;

/** Lines → arguments of the backend (empty lines are dropped). */
export function toSplits(lines: SplitLine[], methods: PayMethod[]) {
  return lines.filter((l) => n(l.amount) > 0).map((l) => {
    const m = methods.find((x) => x.key === l.methodKey);
    return { method: m?.name ?? l.methodKey, methodId: m?._id as never, amount: n(l.amount), reference: l.reference.trim() || undefined };
  });
}
/** "Cash 10,000 + M-Pesa 10,000" — for receipts. */
export const describeSplits = (lines: SplitLine[], methods: PayMethod[]) =>
  lines.filter((l) => n(l.amount) > 0).map((l) => `${methods.find((x) => x.key === l.methodKey)?.label.split(" — ")[0] ?? l.methodKey} ${fmt(n(l.amount))}`).join(" + ");

