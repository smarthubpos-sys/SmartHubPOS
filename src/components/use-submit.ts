import { useState } from "react";
import { toast } from "sonner";
import { errorText, tr } from "@/lib/i18n.ts";

/** Runs an async action with a busy flag and success/error toasts in the system language. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, okMessage?: string): Promise<T | undefined> {
    setBusy(true);
    try { const result = await fn(); toast.success(okMessage ?? tr("Taarifa imehifadhiwa kikamilifu.")); return result; }
    catch (error) { toast.error(errorText(error, "Imeshindikana kuhifadhi taarifa.")); return undefined; }
    finally { setBusy(false); }
  }
  return { busy, run };
}
