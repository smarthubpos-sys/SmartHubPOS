import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

/**
 * Changing or deleting stock (quantity adjustment, reconciliation, editing / deactivating existing items) is a permission that
 * nobody has by default - not even Manager or Administrator. The Super Admin ticks it for a role or for one user.
 * The server checks it again on every call.
 */
export function useStockRights() {
  const b = useQuery(api.tenants.current);
  return { ready: b !== undefined, canAdjust: !!b?.canAdjustStock, isSuperAdmin: !!b?.isSuperAdmin };
}
