import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n.ts";
import type { ServicePoint } from "@/lib/sales-flow.ts";

const selectClass = "h-10 rounded-md border bg-background px-3";

/**
 * Optional "where is the customer?" fields for hotels and restaurants: floor, table or room.
 * Every field may stay empty — a business that does not use them simply never touches this.
 */
export default function ServicePointFields({ value, onChange, disabled, className }: { value: ServicePoint; onChange: (next: ServicePoint) => void; disabled?: boolean; className?: string }) {
  const set = (patch: Partial<ServicePoint>) => onChange({ ...value, ...patch });
  return (
    <div className={className ?? "grid gap-3 sm:grid-cols-3"}>
      <label className="grid gap-1 text-sm">{tr("Aina ya eneo")}
        <select className={selectClass} value={value.kind} disabled={disabled} onChange={(e) => set({ kind: e.target.value === "room" ? "room" : "table" })}>
          <option value="table">{tr("Meza")}</option>
          <option value="room">{tr("Chumba")}</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">{tr("Ghorofa (hiari)")}
        <Input value={value.floor} maxLength={40} disabled={disabled} onChange={(e) => set({ floor: e.target.value })} />
      </label>
      <label className="grid gap-1 text-sm">{value.kind === "room" ? tr("Namba au jina la chumba") : tr("Namba ya meza (hiari)")}
        <Input value={value.name} maxLength={40} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
      </label>
    </div>
  );
}
