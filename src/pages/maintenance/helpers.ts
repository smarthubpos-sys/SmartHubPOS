import { useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { tr, trMessage } from "@/lib/i18n.ts";

/** Runs an async action, showing toasts, and tracks a busy flag. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok = tr("Imehifadhiwa.")) => {
    setBusy(true);
    try { await fn(); toast.success(ok); return true; }
    catch (error) { toast.error(cleanError(error)); return false; }
    finally { setBusy(false); }
  };
  return { busy, run };
}

/** Convex wraps server errors in long text; show only the useful line. */
function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Uncaught Error: ([^\n]+)/) ?? message.match(/Error: ([^\n]+)/);
  return trMessage((match?.[1] ?? message).replace(/ at (async )?handler.*$/, "").trim());
}

export function useMaintenanceSettings() {
  return useQuery(api.maintenance.getSettings, {});
}
