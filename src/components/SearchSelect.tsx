import { useEffect, useMemo, useRef, useState } from "react";
import { tr } from "@/lib/i18n.ts";

export type SearchOption = { value: string; label: string; hint?: string };
type Props = { options: SearchOption[]; value: string; onChange: (value: string) => void; placeholder?: string; className?: string; allowEmpty?: string; disabled?: boolean };

/** A select you can type in: filters by name (or code/phone in the hint) as you type — for long supplier / client lists. */
export default function SearchSelect({ options, value, onChange, placeholder, className = "", allowEmpty, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(t)) : options;
    return list.slice(0, 80);
  }, [options, q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={disabled} role="combobox" aria-expanded={open} autoComplete="off"
        placeholder={placeholder ?? tr("Andika jina kutafuta…")}
        value={open ? q : selected?.label ?? ""}
        onFocus={() => { setOpen(true); setActive(0); }} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); pick(shown[active].value); }
          else if (e.key === "Escape") { setOpen(false); setQ(""); }
        }}
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {allowEmpty && <li className="cursor-pointer rounded px-2 py-2 text-muted-foreground hover:bg-accent" onMouseDown={(e) => { e.preventDefault(); pick(""); }}>{allowEmpty}</li>}
          {shown.map((o, i) => (
            <li key={o.value} className={`cursor-pointer rounded px-2 py-2 ${i === active ? "bg-accent" : "hover:bg-accent"} ${o.value === value ? "font-semibold" : ""}`} onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}>
              {o.label}{o.hint && <span className="ml-2 text-xs text-muted-foreground">{o.hint}</span>}
            </li>
          ))}
          {!shown.length && <li className="px-2 py-2 text-muted-foreground">{tr("Hakuna kinachofanana.")}</li>}
        </ul>
      )}
    </div>
  );
}
