
export type Paper = "80mm" | "58mm" | "A4";

export const readPaper = (): Paper => {
  try {
    const saved = localStorage.getItem("smarthub-print-paper");
    return saved === "58mm" || saved === "A4" ? saved : "80mm";
  } catch {
    return "80mm";
  }
};

export const savePaper = (paper: Paper) => {
  try {
    localStorage.setItem("smarthub-print-paper", paper);
  } catch {
    /* storage unavailable */
  }
};

/**
 * Print one receipt in an isolated iframe using the app's CSS.
 * This preserves the existing browser-print fallback.
 */
export function printElement(
  el: HTMLElement | null,
  paper: Paper,
  opts: { landscape?: boolean } = {},
) {
  if (!el) return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Print preview");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;

  if (!doc || !win) {
    iframe.remove();
    return;
  }

  const styles = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style'),
  )
    .map((node) => node.outerHTML)
    .join("\n");

  const page =
    paper === "A4"
      ? `@page{size:A4 ${opts.landscape ? "landscape" : "portrait"};margin:10mm}
         .print-area{width:100%!important;max-width:none!important}`
      : `@page{size:${paper} auto;margin:2mm}
         .print-area{width:${paper}!important;max-width:${paper}!important}
         table{width:100%;table-layout:fixed}
         th,td{overflow-wrap:anywhere;padding:2px 1px;font-size:10px}`;

  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.add("print-area");

  doc.open();
  doc.write(`<!doctype html>
<html lang="${document.documentElement.lang || "sw"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${document.baseURI}">
${styles}
<style>
html,body{background:#fff!important;color:#111!important;margin:0;padding:0;width:100%}
body{font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.print-area{box-sizing:border-box;margin:0 auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:#fff!important;color:#111!important}
.print-area .overflow-x-auto,.print-area .overflow-hidden{overflow:visible!important;max-width:100%!important}
.print-area table{border-collapse:collapse;max-width:100%}
.print-area thead{display:table-header-group}
.print-area tr,.print-area img{break-inside:avoid}
.print-area button,.print-area input,.print-area select,.print-area textarea,[data-print-hide="true"]{display:none!important}
${paper === "A4"
    ? ".print-area{padding:0!important}"
    : ".print-area{padding:0!important}.print-area *{box-sizing:border-box}"}
${page}
@media print{
  html,body{height:auto!important}
  .print-area{position:static!important;overflow:visible!important}
  .print-area *{visibility:visible!important}
}
</style>
</head>
<body></body>
</html>`);
  doc.close();

  doc.body.appendChild(doc.importNode(clone, true));

  let done = false;
  const cleanup = () => window.setTimeout(() => iframe.remove(), 1000);

  const run = async () => {
    if (done) return;
    done = true;

    try {
      await Promise.race([
        Promise.all([
          doc.fonts?.ready ?? Promise.resolve(),
          ...Array.from(doc.images).map(
            (img) =>
              img.complete
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                    img.addEventListener("load", () => resolve(), {
                      once: true,
                    });
                    img.addEventListener("error", () => resolve(), {
                      once: true,
                    });
                    window.setTimeout(resolve, 1800);
                  }),
          ),
        ]),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2200)),
      ]);
    } catch {
      // Print even if an optional font or image fails to load.
    }

    win.addEventListener("afterprint", cleanup, { once: true });
    win.focus();
    win.print();
    window.setTimeout(() => iframe.remove(), 60_000);
  };

  iframe.addEventListener("load", () => {
    void run();
  }, { once: true });

  // Fallback if the iframe load event does not fire.
  window.setTimeout(() => {
    void run();
  }, 2500);
}

/**
 * Build a standalone HTML document for printing through QZ Tray.
 * The app's styles and the receipt markup are included.
 */
export function buildReceiptHtml(
  el: HTMLElement,
  paper: Paper,
): string {
  const styles = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style'),
  )
    .map((node) => node.outerHTML)
    .join("\n");

  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.add("print-area");

  clone
    .querySelectorAll(
      'button,input,select,textarea,[data-print-hide="true"]',
    )
    .forEach((node) => node.remove());

  const page =
    paper === "A4"
      ? "@page{size:A4 portrait;margin:10mm}.print-area{width:100%!important;max-width:none!important}"
      : `@page{size:${paper} auto;margin:2mm}.print-area{width:${paper}!important;max-width:${paper}!important}`;

  return `<!doctype html>
<html lang="${document.documentElement.lang || "sw"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${document.baseURI}">
${styles}
<style>
html,body{background:#fff!important;color:#111!important;margin:0;padding:0;width:100%}
body{font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.print-area{box-sizing:border-box;margin:0 auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:#fff!important;color:#111!important;padding:0!important}
.print-area .overflow-x-auto,.print-area .overflow-hidden{overflow:visible!important;max-width:100%!important}
.print-area table{border-collapse:collapse;max-width:100%;width:100%}
.print-area thead{display:table-header-group}
.print-area tr,.print-area img{break-inside:avoid}
${paper === "A4" ? "" : ".print-area *{box-sizing:border-box}th,td{overflow-wrap:anywhere;padding:2px 1px;font-size:10px}"}
${page}
</style>
</head>
<body>${clone.outerHTML}</body>
</html>`;
}
