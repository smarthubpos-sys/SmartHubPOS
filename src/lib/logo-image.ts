/**
 * Business logo helper: accepts a logo FILE (jpg / jpeg / jfif / png / webp / gif / bmp / svg), even when the browser gives it no
 * file type, and turns it into a small data URL that is safe to store and to print.
 * A big logo (for example 2576x2576 px) is shrunk instead of being refused, so the owner never has to resize it by hand.
 */
export const LOGO_MAX_SIDE = 480; // enough for 80 mm receipts and A4 headers
export const LOGO_MAX_BYTES = 250_000; // size of the stored data URL

const EXT = /\.(jpe?g|jfif|pjpeg|pjp|png|webp|gif|bmp|svg)$/i;

/** True for a logo/image file, judged by the browser file type first and by the file name when the type is empty or generic. */
export function isLogoFile(file: { name?: string; type?: string }): boolean {
  const type = String(file.type ?? "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type === "" || type === "application/octet-stream") return EXT.test(String(file.name ?? ""));
  return false;
}

/** Size (in px) the logo is drawn at: never larger than `max` on its longest side, never enlarged. */
export function fitSize(width: number, height: number, max = LOGO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("read"));
  r.readAsDataURL(file);
});

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("decode"));
  img.src = src;
});

/** Does the picture have see-through pixels? (then it must stay PNG, not JPEG) */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch { /* tainted or unsupported: treat as opaque */ }
  return false;
}

/** File -> small data URL ready to be saved as the business logo. Throws Error(message in Kiswahili) when the file cannot be used. */
export async function prepareLogo(file: File): Promise<{ dataUrl: string; resized: boolean }> {
  if (!isLogoFile(file)) throw new Error("NOT_IMAGE");
  const original = await readAsDataUrl(file);
  const img = await loadImage(original).catch(() => { throw new Error("UNREADABLE"); });
  const natural = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  const isSvg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
  if (isSvg) { // vector logos are already small; keep as they are when they fit
    if (original.length <= LOGO_MAX_BYTES) return { dataUrl: original, resized: false };
  }
  const small = original.length <= LOGO_MAX_BYTES && Math.max(natural.width, natural.height) <= LOGO_MAX_SIDE * 2;
  if (small && !isSvg) return { dataUrl: original, resized: false };

  let { width, height } = fitSize(natural.width || LOGO_MAX_SIDE, natural.height || LOGO_MAX_SIDE);
  if (!width || !height) ({ width, height } = { width: LOGO_MAX_SIDE, height: LOGO_MAX_SIDE });
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("UNREADABLE");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    const png = hasAlpha(ctx, width, height);
    if (!png) { ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); }
    const out = png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", Math.max(0.6, 0.9 - attempt * 0.07));
    if (out.length <= LOGO_MAX_BYTES) return { dataUrl: out, resized: true };
    width = Math.max(64, Math.round(width * 0.8)); height = Math.max(64, Math.round(height * 0.8));
  }
  throw new Error("TOO_BIG");
}


/** Otsu threshold (0-255) of a grayscale histogram: the level that best separates "ink" from "paper". */
export function otsuThreshold(hist: number[]): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return 128;
  let sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 128, max = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > max) { max = between; best = t; }
  }
  return best;
}

const printLogoCache = new Map<string, Promise<string>>();

/**
 * Logo -> sharp black-and-white picture for a receipt printer. Roll printers print in 1 bit (ink or no ink): a coloured or light-grey
 * logo turns pale or vanishes. Every pixel becomes solid black or white (see-through = white), so the logo prints dark and clear.
 * Never throws: when the picture cannot be processed the original is returned.
 */
export function logoForPrint(src: string): Promise<string> {
  if (!src || typeof document === "undefined") return Promise.resolve(src);
  const hit = printLogoCache.get(src); if (hit) return hit;
  const job = (async () => {
    try {
      const img = await loadImage(src);
      const { width, height } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, 400);
      if (!width || !height) return src;
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return src;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, width, height);
      const frame = ctx.getImageData(0, 0, width, height); const d = frame.data;
      const hist = new Array<number>(256).fill(0); const gray = new Uint8Array(width * height);
      for (let i = 0, k = 0; i < d.length; i += 4, k++) { const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); gray[k] = g; hist[g]++; }
      // lean towards black: anything clearly darker than paper prints as ink, so pale logos do not fade away
      const limit = Math.min(235, otsuThreshold(hist) + 30);
      for (let i = 0, k = 0; i < d.length; i += 4, k++) { const v = gray[k] <= limit ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      ctx.putImageData(frame, 0, 0);
      return canvas.toDataURL("image/png");
    } catch { return src; }
  })();
  printLogoCache.set(src, job);
  if (printLogoCache.size > 20) printLogoCache.delete(printLogoCache.keys().next().value as string);
  return job;
}

/** Replaces the receipt logo (<img class="logo">) inside a receipt HTML string by its sharp black-and-white version. */
export async function sharpenReceiptLogo(html: string): Promise<string> {
  const m = /(<img class="logo"[^>]*?\ssrc=")([^"]+)(")/.exec(html);
  if (!m) return html;
  const original = m[2].replace(/&amp;/g, "&");
  const sharp = await logoForPrint(original);
  return sharp === original ? html : html.replace(m[0], `${m[1]}${sharp}${m[3]}`);
}
