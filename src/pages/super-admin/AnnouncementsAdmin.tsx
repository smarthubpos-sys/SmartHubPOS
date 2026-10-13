import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Eye, EyeOff, Megaphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { AdSlide } from "@/components/ads-carousel.tsx";
import { errorText, tr } from "@/lib/i18n.ts";
import { formatDate } from "@/lib/format.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const THEMES = [["blue", "bg-blue-500"], ["green", "bg-emerald-500"], ["orange", "bg-orange-500"], ["purple", "bg-violet-500"], ["red", "bg-rose-500"]] as const;

/** Super Admin: ad banners (shown on every dashboard) and messages (notification + popup) for all businesses or one. */
export default function AnnouncementsAdmin() {
  const rows = useQuery(api.announcements.list, {});
  const businesses = useQuery(api.tenants.listForPicker, {});
  const create = useMutation(api.announcements.create);
  const setActive = useMutation(api.announcements.setActive);
  const remove = useMutation(api.announcements.remove);
  const [kind, setKind] = useState<"banner" | "message">("message");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [theme, setTheme] = useState("blue");
  const [tenantId, setTenantId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const field = "bg-white text-slate-900";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await create({ kind, title, body, theme, tenantId: (tenantId || undefined) as Id<"tenants"> | undefined,
        imageUrl: kind === "banner" ? imageUrl || undefined : undefined, linkUrl: kind === "banner" ? linkUrl || undefined : undefined,
        startsAt: startsAt || undefined, endsAt: endsAt || undefined });
      toast.success(kind === "message" ? tr("Ujumbe umetumwa.") : tr("Tangazo limechapishwa."));
      setTitle(""); setBody(""); setImageUrl(""); setLinkUrl(""); setStartsAt(""); setEndsAt("");
    } catch (err) { toast.error(errorText(err, "Hitilafu imetokea.")); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={send} className="space-y-4 rounded-2xl border border-white/10 bg-[#061f4b]/80 p-5">
        <div className="flex flex-wrap gap-2">
          {([["message", tr("Ujumbe kwa wateja")], ["banner", tr("Tangazo (bango)")]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium ${kind === k ? "border-primary bg-primary text-primary-foreground" : "border-white/30 hover:bg-white/10"}`}>{label}</button>
          ))}
        </div>
        <p className="text-xs text-blue-100">{kind === "message" ? tr("Ujumbe unaonekana kwenye Notifications za kila mtumiaji, na unafunguka kama dirisha mara ya kwanza anapoingia.") : tr("Tangazo linaonekana juu ya Dashboard kama bango la app ya simu, linazunguka kila sekunde 6.")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm md:col-span-2">{tr("Kichwa")}<Input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
          <label className="grid gap-1 text-sm md:col-span-2">{kind === "message" ? tr("Ujumbe") : tr("Maelezo mafupi (hiari)")}
            <textarea required={kind === "message"} maxLength={1000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className={`${field} w-full rounded-md border px-3 py-2 text-sm`} /></label>
          {kind === "banner" && <>
            <label className="grid gap-1 text-sm">{tr("Kiungo cha picha (https://…, hiari)")}<Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://" className={field} /></label>
            <label className="grid gap-1 text-sm">{tr("Kiungo cha kufungua (https://…, hiari)")}<Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" className={field} /></label>
            <div className="grid gap-1 text-sm md:col-span-2">{tr("Rangi")}
              <div className="flex gap-2">{THEMES.map(([name, cls]) => <button key={name} type="button" aria-label={name} onClick={() => setTheme(name)} className={`h-7 w-7 cursor-pointer rounded-full ${cls} ${theme === name ? "ring-2 ring-white ring-offset-2 ring-offset-[#061f4b]" : ""}`} />)}</div></div>
          </>}
          <label className="grid gap-1 text-sm">{tr("Anayepokea")}
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={`${field} h-9 rounded-md border px-2 text-sm`}>
              <option value="">{tr("Biashara zote")}</option>
              {businesses?.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-sm">{tr("Kuanzia (hiari)")}<Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} /></label>
            <label className="grid gap-1 text-sm">{tr("Hadi (hiari)")}<Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} /></label>
          </div>
        </div>
        {kind === "banner" && <div className="overflow-hidden rounded-2xl"><AdSlide ad={{ title, body, imageUrl, linkUrl, theme }} /></div>}
        <Button type="submit" disabled={busy}><Megaphone className="mr-1 h-4 w-4" />{busy ? tr("Inatuma…") : kind === "message" ? tr("Tuma ujumbe") : tr("Chapisha tangazo")}</Button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-white">{tr("Yaliyotumwa")}</h2>
        {rows === undefined && <p className="text-sm text-blue-100">{tr("Inapakia…")}</p>}
        {rows?.length === 0 && <p className="rounded-2xl border border-white/10 bg-[#061f4b]/60 p-4 text-sm">{tr("Bado hujatuma tangazo wala ujumbe.")}</p>}
        {rows?.map((r) => (
          <article key={r._id} className={`flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#061f4b]/70 p-3 text-sm ${r.isActive ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{r.title}</p>
              <p className="text-xs text-blue-200">{r.kind === "message" ? tr("Ujumbe") : tr("Tangazo")} · {r.tenantName ?? tr("Biashara zote")} · {tr("Watumiaji {0}", [r.reach])} · {formatDate(r.startsAt ?? r.createdAt)}{r.endsAt ? ` → ${formatDate(r.endsAt)}` : ""}</p>
            </div>
            <Button size="sm" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => void setActive({ id: r._id, isActive: !r.isActive })}>{r.isActive ? <><EyeOff className="mr-1 h-4 w-4" />{tr("Ficha")}</> : <><Eye className="mr-1 h-4 w-4" />{tr("Onyesha")}</>}</Button>
            <Button size="sm" variant="outline" aria-label={tr("Futa")} className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => { if (window.confirm(tr("Futa \"{0}\"?", [r.title]))) void remove({ id: r._id }); }}><Trash2 className="h-4 w-4" /></Button>
          </article>
        ))}
      </div>
    </div>
  );
}
