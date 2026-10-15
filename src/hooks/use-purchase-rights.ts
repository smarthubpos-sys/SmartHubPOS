import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

/** What the signed-in user may do with purchase documents (set per role in Role Management, or per user in User Settings). */
export function usePurchaseRights() {
  const b = useQuery(api.tenants.current);
  return { canEdit: !!b?.canEditPurchase, canDelete: !!b?.canDeletePurchase };
}
