export type Paper = "80mm" | "58mm" | "A4";

export const readPaper = (): Paper => {
  try { const saved = localStorage.getItem("smarthub-print-paper"); return saved === "58mm" || saved === "A4" ? saved : "80mm"; } catch { return "80mm"; }
};
export const savePaper = (paper: Paper) => { try { localStorage.setItem("smarthub-print-paper", paper); } catch { /* storage unavailable */ } };

/**
 * Prints ONE element (a bill / receipt) on its own, in a hidden frame, so nothing else of the app
 * (menu, dashboard, page header) can end up on the paper. The app's own styles are copied into the frame.
 */
export function printElement(el: HTMLElement | null, paper: Paper) {
  if (!el) return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) { iframe.remove(); return; }

  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((n) => n.outerHTML).join("");
  const page = paper === "A4"
    ? "@page{size:A4 portrait;margin:10mm}.print-area{width:100%!important;max-width:none!important}"
    : `@page{size:${paper} auto;margin:2mm}.print-area{width:${paper}!important;max-width:${paper}!important}table{width:100%;table-layout:fixed}th,td{overflow-wrap:anywhere;padding:2px 1px;font-size:10px}`;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.add("print-area");
  doc.open();
  doc.write(`<!doctype html><html lang="${document.documentElement.lang || "sw"}"><head><meta charset="utf-8"><base href="${document.baseURI}">${styles}<style>html,body{background:#fff!important;color:#000;margin:0;padding:0}.print-area{margin:0 auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:#fff!important}${paper === "A4" ? "" : ".print-area{padding:0!important}"}${page}</style></head><body></body></html>`);
  doc.close();
  doc.body.appendChild(doc.importNode(clone, true));

  let done = false;
  const cleanup = () => window.setTimeout(() => iframe.remove(), 1000);
  const run = () => {
    if (done) return;
    done = true;
    win.addEventListener("afterprint", cleanup, { once: true });
    win.focus();
    win.print();
    window.setTimeout(() => iframe.remove(), 60_000);
  };
  iframe.addEventListener("load", run, { once: true });
  window.setTimeout(run, 700);
}
