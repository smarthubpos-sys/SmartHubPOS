import { MODULES } from "@/convex/permissions";
import { tr } from "@/lib/i18n.ts";

/**
 * Tick-boxes for the sidebar modules. Used by the Super Admin (what a business has paid for)
 * and by managers (what each user may open). `available` limits the list to what the business has.
 */
export default function ModulePicker({ value, onChange, available, light = false, disabled = false }: {
  value: string[]; onChange: (next: string[]) => void; available?: string[]; light?: boolean; disabled?: boolean;
}) {
  const shown = MODULES.filter((m) => !available || available.includes(m.key));
  const toggle = (key: string, on: boolean) => onChange(on ? [...new Set([...value, key])] : value.filter((k) => k !== key));
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {shown.map((m) => {
        const locked = !!m.core; // Dashboard and Help are always available
        const checked = locked || value.includes(m.key);
        return (
          <label key={m.key} className={`flex items-center gap-2 text-sm ${locked || disabled ? "opacity-70" : "cursor-pointer"} ${light ? "text-white" : ""}`}>
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={checked} disabled={locked || disabled} onChange={(e) => toggle(m.key, e.target.checked)} />
            {tr(m.label)}
          </label>
        );
      })}
    </div>
  );
}
