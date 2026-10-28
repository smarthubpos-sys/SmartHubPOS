/** Turns a phone number as typed (0712…, +255712…, 00255712…) into the digits wa.me needs. Returns "" when it is not usable. */
export function whatsappPhone(raw: string | undefined | null): string {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  const full = digits.startsWith("00") ? digits.slice(2) : digits.startsWith("0") ? `255${digits.slice(1)}` : digits;
  return full.length >= 9 ? full : "";
}

export type WhatsappOrder = {
  companyName?: string;
  customerName: string;
  tableNumber?: string;
  total: number;
  lines: { name: string; qty: number; lineTotal: number }[];
  paymentInfo?: string[];
  footer?: string;
};

const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

export function whatsappOrderText(o: WhatsappOrder): string {
  return [
    o.companyName?.trim() || "",
    `Mteja: ${o.customerName}`,
    o.tableNumber ? `Meza: ${o.tableNumber}` : "",
    "",
    ...o.lines.map((l) => `${l.name} × ${money(l.qty)} = ${money(l.lineTotal)}/=`),
    "",
    `JUMLA: ${money(o.total)}/=`,
    ...(o.paymentInfo?.length ? ["", ...o.paymentInfo] : []),
    ...(o.footer?.trim() ? ["", o.footer.trim()] : []),
  ].filter((x, i, a) => !(x === "" && (i === 0 || a[i - 1] === ""))).join("\n");
}

export const whatsappUrl = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
