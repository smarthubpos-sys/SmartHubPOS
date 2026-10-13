import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { ExternalLink, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { tr } from "@/lib/i18n.ts";

export type Ad = { _id?: string; title: string; body?: string; imageUrl?: string; linkUrl?: string; theme?: string };

const THEMES: Record<string, string> = {
  blue: "from-blue-600 to-cyan-500",
  green: "from-emerald-600 to-teal-500",
  orange: "from-orange-500 to-amber-400",
  purple: "from-violet-600 to-fuchsia-500",
  red: "from-rose-600 to-orange-500",
};
const HIDE_KEY = "smarthub.ads.hidden";
const readHidden = () => { try { return window.sessionStorage.getItem(HIDE_KEY) ?? ""; } catch { return ""; } };

/** One banner, like the promo cards in a mobile app. Also used for the preview in the Super Admin form. */
export function AdSlide({ ad }: { ad: Ad }) {
  const [failedUrl, setFailedUrl] = useState("");
  const imgOk = failedUrl !== ad.imageUrl;
  const safeLink = ad.linkUrl && /^https:\/\//i.test(ad.linkUrl) ? ad.linkUrl : undefined;
  return (
    <div className={`flex min-h-[120px] items-center gap-4 bg-gradient-to-r ${THEMES[ad.theme ?? "blue"] ?? THEMES.blue} p-5 text-white`}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-lg font-extrabold leading-tight md:text-xl">{ad.title || tr("Kichwa cha tangazo")}</p>
        {ad.body && <p className="line-clamp-3 text-sm text-white/90">{ad.body}</p>}
        {safeLink && <a href={safeLink} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-white">{tr("Fungua")}<ExternalLink className="h-3 w-3" /></a>}
      </div>
      {ad.imageUrl && imgOk && <img src={ad.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(ad.imageUrl ?? "")} className="h-24 w-24 shrink-0 rounded-xl object-cover shadow-lg md:h-28 md:w-40" />}
    </div>
  );
}

/** Auto-rotating banners set by the Super Admin (Super Admin > Matangazo). Renders nothing when there are none. */
export default function AdsCarousel() {
  const ads = useQuery(api.announcements.banners, {});
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(readHidden);
  const visible = (ads ?? []).filter((a) => !hidden.split(",").includes(String(a._id)));
  useEffect(() => {
    if (visible.length < 2) return;
    const t = window.setInterval(() => setIndex((i) => i + 1), 6000);
    return () => window.clearInterval(t);
  }, [visible.length]);
  if (visible.length === 0) return null;
  const current = visible[index % visible.length];
  const close = () => {
    const next = [hidden, String(current._id)].filter(Boolean).join(",");
    setHidden(next);
    try { window.sessionStorage.setItem(HIDE_KEY, next); } catch { /* storage unavailable */ }
  };
  return (
    <section className="relative overflow-hidden rounded-2xl shadow-md" aria-label={tr("Matangazo")}>
      <AdSlide ad={current} />
      <button type="button" onClick={close} aria-label={tr("Funga tangazo")} className="absolute right-2 top-2 cursor-pointer rounded-full bg-black/25 p-1 text-white hover:bg-black/40"><X className="h-3.5 w-3.5" /></button>
      {visible.length > 1 && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
          {visible.map((a, i) => <button key={a._id} type="button" aria-label={`${i + 1}`} onClick={() => setIndex(i)} className={`h-1.5 cursor-pointer rounded-full transition-all ${i === index % visible.length ? "w-5 bg-white" : "w-1.5 bg-white/50"}`} />)}
        </div>
      )}
    </section>
  );
}
