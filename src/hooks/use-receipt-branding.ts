import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { brandingFromSettings, type ReceiptBranding } from "@/lib/receipt-branding.ts";

/** Logo, business name, phone, payment info and footer taken from Maintenance > Company / System settings. */
export function useReceiptBranding(): ReceiptBranding {
  const settings = useQuery(api.maintenance.getSettings, {});
  return brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
}
