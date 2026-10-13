import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt, num } from "@/pages/shared/report.tsx";
import { tr, errorText } from "@/lib/i18n.ts";

const empty = { code: "", name: "", phone: "", email: "", address: "", taxId: "", contactPerson: "", openingBalance: "0", creditLimit: "", creditPolicy: "allow", paymentTerms: "", notes: "", isActive: "true" };

export default function SalesClients() {
  const navigate = useNavigate();
  const data = useQuery(api.sales.salesRegisters, {});
  const upsert = useMutation(api.clients.upsert);
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [id, setId] = useState("");
  const [search, setSearch] = useState("");
  const [f, setF] = useState<Record<string, string>>(empty);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  if (!data) return <div className="p-6 text-sm text-muted-foreground">{tr("Inapakia…")}</div>;

  const balanceOf = (cid: string) => data.balances.find((b) => b.clientId === cid)?.closing ?? 0;
  const run = async (fn: () => Promise<unknown>, ok = tr("Taarifa zimehifadhiwa.")) => {
    try { await fn(); toast.success(ok); return true; } catch (e) { toast.error(errorText(e, "Hitilafu imetokea.")); return false; }
  };
  const nextCode = `C${String(data.clients.length + 1).padStart(4, "0")}`;
  const start = (c?: (typeof data.clients)[number]) => {
    setId(c?._id ?? "");
    setF(c ? { code: c.code, name: c.name, phone: c.phone, email: c.email, address: c.address, taxId: "", contactPerson: c.contactPerson, openingBalance: String(c.openingBalance), creditLimit: c.creditLimit === null ? "" : String(c.creditLimit), creditPolicy: c.creditPolicy, paymentTerms: "", notes: "", isActive: String(c.isActive) } : { ...empty, code: nextCode });
    setMode("edit");
  };
  const field = (label: string, key: string, type = "text") => <label className="grid gap-1 text-sm">{label}<Input type={type} step={type === "number" ? "any" : undefined} value={f[key] ?? ""} onChange={(e) => set(key, e.target.value)} /></label>;

  if (mode === "edit") {
    return (
      <main className="mx-auto max-w-5xl space-y-5 p-5">
        <Button variant="outline" onClick={() => setMode("list")}>{tr("← Rudi kwenye wateja")}</Button>
        <h1 className="text-2xl font-bold">{id ? tr("Modify Client") : tr("Add Client")}</h1>
        <section className="grid gap-4 rounded-xl border p-5 md:grid-cols-2">
          {field(tr("Client Code"), "code")}{field(tr("Jina la mteja"), "name")}{field(tr("Simu"), "phone")}{field(tr("Email"), "email", "email")}{field(tr("Anwani"), "address")}{field(tr("Contact Person"), "contactPerson")}
          {field(tr("Opening Balance (deni la mwanzo)"), "openingBalance", "number")}{field(tr("Credit Limit (hiari)"), "creditLimit", "number")}
          <label className="grid gap-1 text-sm">{tr("Credit Policy")}
            <select className="h-10 rounded-md border bg-background px-3" value={f.creditPolicy} onChange={(e) => set("creditPolicy", e.target.value)}>
              <option value="allow">{tr("Allow")}</option><option value="warn">{tr("Warn")}</option><option value="require_approval">{tr("Require approval")}</option><option value="block">{tr("Block")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={f.isActive === "true"} onChange={(e) => set("isActive", String(e.target.checked))} />{tr("Mteja yupo active")}</label>
          <div className="md:col-span-2"><Button onClick={() => void (async () => {
            if (!f.code.trim() || !f.name.trim()) { toast.error(tr("Client code na jina vinahitajika.")); return; }
            const ok = await run(() => upsert({ id: id ? (id as Id<"clients">) : undefined, code: f.code.trim(), name: f.name.trim(), phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, address: f.address.trim() || undefined, contactPerson: f.contactPerson.trim() || undefined, openingBalance: num(f.openingBalance), creditLimit: f.creditLimit === "" ? undefined : num(f.creditLimit), creditPolicy: f.creditPolicy, isActive: f.isActive === "true" }));
            if (ok) setMode("list");
          })()}>{tr("Save Changes")}</Button></div>
        </section>
      </main>
    );
  }

  const q = search.trim().toLowerCase();
  const shown = data.clients.filter((c) => !q || [c.name, c.code, c.phone].some((x) => x.toLowerCase().includes(q)));
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-5">
      <Button variant="outline" onClick={() => navigate("/sales")}>{tr("← Sales")}</Button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{tr("Add / Modify Client")}</h1>
        <div className="flex gap-2">
          {!data.clients.length && <Button variant="outline" onClick={() => void run(() => upsert({ code: "CASH", name: "Cash Customer", openingBalance: 0, creditPolicy: "block", isActive: true }), tr("Cash Customer imetengenezwa."))}>{tr("Tengeneza “Cash Customer”")}</Button>}
          <Button onClick={() => start()}>{tr("＋ Add Client")}</Button>
        </div>
      </div>
      <Input className="max-w-sm" placeholder={tr("Tafuta mteja…")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <section className="overflow-hidden rounded-xl border"><div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr>{[tr("Code"), tr("Jina"), tr("Simu"), tr("Balance (deni)"), tr("Hali"), ""].map((h) => <th key={h} className="whitespace-nowrap bg-muted/50 p-3">{h}</th>)}</tr></thead>
          <tbody>{shown.map((c) => (
            <tr key={c._id} className="border-t"><td className="p-3">{c.code}</td><td className="p-3 font-medium">{c.name}</td><td className="p-3">{c.phone || "—"}</td><td className="p-3 text-right tabular-nums">{fmt(balanceOf(c._id))}</td><td className="p-3">{c.isActive ? tr("Active") : tr("Imezimwa")}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => start(c)}>{tr("Modify")}</Button></td></tr>
          ))}</tbody>
        </table>
        {!shown.length && <p className="p-5 text-sm text-muted-foreground">{tr("Hakuna mteja bado.")}</p>}
      </div></section>
    </main>
  );
}
