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
