import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { tr } from "@/lib/i18n.ts";

export type Ad = { _id?: string; title: string; body?: string; imageUrl?: string; linkUrl?: string; theme?: string };

const THEMES: Record<string, string> = {
  blue: "from-blue-700 to-cyan-500",
  green: "from-emerald-700 to-teal-500",
  orange: "from-orange-600 to-amber-400",
  purple: "from-violet-700 to-fuchsia-500",
  red: "from-rose-700 to-orange-500",
};
const HIDE_KEY = "smarthub.ads.hidden";
const SLIDE_MS = 6000;
const readHidden = () => { try { return window.sessionStorage.getItem(HIDE_KEY) ?? ""; } catch { return ""; } };
const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * One banner, like the promo cards in a mobile app. Also used for the live preview in the Super Admin form (`preview`).
 * With a picture it fills the right side (full background on phones); without one the colour carries the message.
 * When the ad has a link the whole banner opens it.
 */
export function AdSlide({ ad, preview = false, onOpen }: { ad: Ad; preview?: boolean; onOpen?: () => void }) {
  const [failedUrl, setFailedUrl] = useState("");
  const showImage = !!ad.imageUrl && failedUrl !== ad.imageUrl;
  const link = ad.linkUrl && /^https:\/\//i.test(ad.linkUrl) ? ad.linkUrl : undefined;
  const inner = (
    <div className={`relative isolate flex min-h-[132px] items-center overflow-hidden bg-gradient-to-r ${THEMES[ad.theme ?? "blue"] ?? THEMES.blue} text-white md:min-h-[148px]`}>
      {showImage && (
        <>
          <img src={ad.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(ad.imageUrl ?? "")}
            className="ad-img-fade absolute inset-0 -z-20 h-full w-full object-cover md:left-[46%] md:w-[54%]" />
          <div className="absolute inset-0 -z-10 bg-black/45 md:hidden" />
        </>
      )}
      <div className="min-w-0 space-y-1.5 p-5 pr-12 md:max-w-[60%] md:pr-5">
        <p className="text-lg font-extrabold leading-tight drop-shadow-sm md:text-2xl">{ad.title || tr("Kichwa cha tangazo")}</p>
        {ad.body && <p className="line-clamp-3 text-sm text-white/90 md:text-base">{ad.body}</p>}
        {link && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-slate-900 shadow-sm">{tr("Fungua")}<ExternalLink className="h-3 w-3" /></span>}
      </div>
    </div>
  );
  if (!link || preview) return inner;
  return <a href={link} target="_blank" rel="noopener noreferrer" onClick={onOpen} className="block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">{inner}</a>;
}

/** Auto-rotating banners set by the Super Admin (Super Admin > Matangazo). Renders nothing when there are none. */
export default function AdsCarousel() {
  const ads = useQuery(api.announcements.banners, {});
  const trackClick = useMutation(api.announcements.trackClick);
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(readHidden);
  const [paused, setPaused] = useState(false);
  const [pageHidden, setPageHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [reduced] = useState(prefersReducedMotion);
  const touchX = useRef<number | null>(null);
  const hiddenIds = hidden.split(",");
  const visible = (ads ?? []).filter((a) => !hiddenIds.includes(String(a._id)));
  const count = visible.length;
  const at = count ? ((index % count) + count) % count : 0;

  useEffect(() => {
    const onVis = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const go = useCallback((n: number) => setIndex(count ? ((n % count) + count) % count : 0), [count]);
  if (count === 0) return null;
  const current = visible[at];
  const autoplay = count > 1 && !reduced;
  const close = () => {
    const next = [hidden, String(current._id)].filter(Boolean).join(",");
    setHidden(next);
    try { window.sessionStorage.setItem(HIDE_KEY, next); } catch { /* storage unavailable */ }
  };
  const arrow = "absolute top-1/2 hidden -translate-y-1/2 cursor-pointer rounded-full bg-black/30 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/50 focus-visible:opacity-100 group-hover:opacity-100 sm:block";

  return (
    <section className="group relative overflow-hidden rounded-2xl shadow-md" aria-roledescription="carousel" aria-label={tr("Matangazo")}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; setPaused(true); }}
      onTouchEnd={(e) => {
        const start = touchX.current; touchX.current = null; setPaused(false);
        const dx = start === null ? 0 : (e.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(dx) > 45) go(at + (dx < 0 ? 1 : -1));
      }}>
      <div key={String(current._id)} className="ad-in" aria-live={autoplay && !paused ? "off" : "polite"}>
        <AdSlide ad={current} onOpen={() => { if (current._id) void trackClick({ id: current._id }).catch(() => undefined); }} />
      </div>
      <button type="button" onClick={close} aria-label={tr("Funga tangazo")} className="absolute right-2 top-2 cursor-pointer rounded-full bg-black/30 p-1.5 text-white hover:bg-black/50"><X className="h-3.5 w-3.5" /></button>
      {count > 1 && (
        <>
          <button type="button" onClick={() => go(at - 1)} aria-label={tr("Tangazo lililopita")} className={`${arrow} left-2`}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => go(at + 1)} aria-label={tr("Tangazo linalofuata")} className={`${arrow} right-2`}><ChevronRight className="h-4 w-4" /></button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center">
            {visible.map((a, i) => (
              <button key={a._id} type="button" aria-label={`${i + 1} / ${count}`} aria-current={i === at} onClick={() => go(i)} className="flex h-5 cursor-pointer items-center px-0.5">
                <span className={`block h-1.5 rounded-full transition-all ${i === at ? "w-5 bg-white" : "w-1.5 bg-white/50"}`} />
              </button>
            ))}
          </div>
        </>
      )}
      {autoplay && (
        // The bar IS the timer: when it finishes the next banner shows; hovering/touching pauses it, and it restarts on every change.
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20" aria-hidden>
          <div key={`${String(current._id)}-${at}`} className="ad-progress h-full bg-white/80" style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused || pageHidden ? "paused" : "running" }} onAnimationEnd={() => go(at + 1)} />
        </div>
      )}
    </section>
  );
}
