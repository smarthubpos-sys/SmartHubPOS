import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { trValue } from "@/lib/i18n.ts";

export type PayMethod = { key: string; _id?: string; name: string; label: string; kind: string; accountNo?: string };

/** Used until the business has set up its own list in Maintenance → Njia za Malipo. */
const DEFAULTS: PayMethod[] = [
  { key: "cash", name: "cash", label: trValue("cash"), kind: "cash" },
  { key: "bank", name: "bank", label: trValue("bank"), kind: "bank" },
  { key: "mobile", name: "mobile", label: trValue("mobile"), kind: "mobile" },
];

/** Active payment methods of this business (its own editable list, or Cash/Bank/Mobile Money when none was set up). */
export function usePaymentMethods(): PayMethod[] {
  const rows = useQuery(api.paymentMethods.list, {});
  return useMemo(() => {
    if (!rows || rows.length === 0) return DEFAULTS;
    return rows.filter((r) => r.isActive).map((r) => ({ key: String(r._id), _id: String(r._id), name: r.name, label: r.accountNo ? `${r.name} — ${r.accountNo}` : r.name, kind: r.kind, accountNo: r.accountNo }));
  }, [rows]);
}

/** The method the form should show: the chosen key when it still exists, else the first method of the preferred kind, else the first one. */
export function pickMethodKey(methods: PayMethod[], key: string, preferKind = "cash"): string {
  return methods.some((m) => m.key === key) ? key : (methods.find((m) => m.kind === preferKind) ?? methods[0])?.key ?? key;
}

/** Form value -> backend arguments: the method's name and, for methods of the business's own list, its id (so the money goes to that method's account). */
export function methodArgs(methods: PayMethod[], key: string): { method: string; methodId: never | undefined } {
  const m = methods.find((x) => x.key === key);
  return { method: m?.name ?? key, methodId: m?._id as never };
}
