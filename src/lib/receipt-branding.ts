/** Header / footer data that every printed bill, invoice and order slip shares (logo, business name, phone, payment info, footer). */
export type ReceiptBranding = {
  title?: string;
  companyName?: string;
  address?: string;
  phone?: string;
  logoUrl?: string;
  footer?: string;
  paymentInfo?: string[];
  billId?: string;
  openTime?: string;
};

type SettingsLike = {
  company?: { companyName?: string; address?: string; phone?: string; logoUrl?: string } | null;
  app?: { system?: Record<string, unknown> } & Record<string, unknown>;
} | null | undefined;

const txt = (x: unknown) => (typeof x === "string" ? x.trim() : "");

/** Same payment lines the customer bill prints (only what the business configured). */
export function paymentInfoFrom(sys: Record<string, unknown> | undefined): string[] {
  if (!sys) return [];
  return [
    [txt(sys.mobileMoneyProvider), txt(sys.mobileMoneyNumber)].filter(Boolean).join(": "),
    txt(sys.bankName) ? `Benki: ${txt(sys.bankName)}` : "",
    txt(sys.bankAccountName) ? `Jina la akaunti: ${txt(sys.bankAccountName)}` : "",
    txt(sys.bankAccountNumber) ? `Akaunti: ${txt(sys.bankAccountNumber)}` : "",
    txt(sys.paymentInstructions),
  ].filter(Boolean);
}

export function brandingFromSettings(settings: SettingsLike): ReceiptBranding {
  const c = settings?.company;
  const sys = settings?.app?.system;
  return {
    companyName: txt(c?.companyName),
    address: txt(c?.address),
    phone: txt(c?.phone),
    logoUrl: txt(c?.logoUrl),
    footer: txt(sys?.receiptFooter),
    paymentInfo: paymentInfoFrom(sys),
  };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
/** 2026-10-22 14:55:20 */
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
