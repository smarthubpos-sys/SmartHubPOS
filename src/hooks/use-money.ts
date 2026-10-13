import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { formatNumber } from "@/lib/format.ts";

/** Formats money with the business currency symbol and decimals from Maintenance > Currency. */
export function useMoney() {
  const settings = useQuery(api.dashboard.getSettings);
  const symbol = settings?.currencySymbol ?? "TSh";
  const decimals = settings?.decimalPlaces ?? 0;
  return { symbol, decimals, money: (n: number) => `${symbol} ${formatNumber(n, decimals)}` };
}
