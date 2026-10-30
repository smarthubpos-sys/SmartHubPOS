/**
 * Receipt-printer discovery and test printing.
 *
 * Browsers cannot list the printers installed in the operating system by themselves, so:
 *  - "installed" printers are listed through QZ Tray (free helper app) when it is running;
 *  - "direct" printers are paired through WebUSB / Web Serial (wired, or Bluetooth SPP) / Web Bluetooth (wireless BLE).
 */
import { tr } from "./i18n.ts";

export type DeviceKind = "usb" | "serial" | "bluetooth";
export type DeviceInfo = { kind: DeviceKind; name: string; id?: string; vendorId?: number; productId?: number };

/** Minimal typed browser-device interfaces. These APIs are not included in every DOM lib target. */
type UsbEndpoint = { direction: "in" | "out"; type: string; endpointNumber: number };
type UsbAlternate = { endpoints: UsbEndpoint[] };
type UsbInterface = { interfaceNumber: number; alternates: UsbAlternate[] };
type UsbConfiguration = { interfaces: UsbInterface[] };
type UsbDevice = {
  productName?: string;
  vendorId: number;
  productId: number;
  configuration: UsbConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<unknown>;
};
type UsbApi = { getDevices(): Promise<UsbDevice[]>; requestDevice(options: { filters: object[] }): Promise<UsbDevice> };
type SerialInfo = { usbVendorId?: number; usbProductId?: number };
type SerialWriter = { write(data: BufferSource): Promise<void>; releaseLock(): void };
type SerialPort = {
  getInfo?(): SerialInfo;
  writable: { getWriter(): SerialWriter } | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};
type SerialApi = { getPorts(): Promise<SerialPort[]>; requestPort(): Promise<SerialPort> };
type BluetoothCharacteristic = {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
};
type BluetoothService = { getCharacteristics(): Promise<BluetoothCharacteristic[]> };
type BluetoothServer = { getPrimaryServices(): Promise<BluetoothService[]> };
type BluetoothDevice = {
  id: string;
  name?: string;
  gatt: { connect(): Promise<BluetoothServer>; disconnect(): void } | null;
};
type BluetoothApi = {
  getDevices?: () => Promise<BluetoothDevice[]>;
  requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDevice>;
};
type DeviceNavigator = Navigator & { usb?: UsbApi; serial?: SerialApi; bluetooth?: BluetoothApi };
type QzTrayApi = {
  security: {
    setCertificatePromise(callback: (resolve: (certificate?: string) => void) => void): void;
    setSignatureAlgorithm(algorithm: string): void;
    setSignaturePromise(callback: () => (resolve: (signature?: string) => void) => void): void;
  };
  websocket: { isActive(): boolean; connect(options: { retries: number; delay: number }): Promise<void> };
  printers: { find(): Promise<string | string[]>; getDefault?(): Promise<string> };
  configs: { create(name: string, options?: object): unknown };
  print(config: unknown, data: Array<{ type: string; format: string; flavor?: string; data: string; options?: object }>): Promise<void>;
};

const nav = (): DeviceNavigator => navigator as DeviceNavigator;
export const deviceSupport = {
  usb: () => typeof navigator !== "undefined" && !!nav().usb,
  serial: () => typeof navigator !== "undefined" && !!nav().serial,
  bluetooth: () => typeof navigator !== "undefined" && !!nav().bluetooth,
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ Installed printers (QZ Tray) â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const QZ_CDN = "https://cdn.jsdelivr.net/npm/qz-tray@2.3.0/qz-tray.js";
let qzApi: QzTrayApi | null = null;

/** Loads the QZ client library: from the bundled npm package, or (if the package is missing) from the CDN. */
async function loadQz(): Promise<QzTrayApi> {
  if (qzApi) return qzApi;
  try {
    const mod = await import("qz-tray") as unknown as { default?: QzTrayApi } & QzTrayApi;
    qzApi = mod.default ?? mod;
    return qzApi;
  } catch { /* fall through to the CDN copy */ }
  const w = window as unknown as { qz?: QzTrayApi };
  if (!w.qz) {
    await new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = QZ_CDN; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(tr("Imeshindikana kupakia maktaba ya QZ Tray. Angalia intaneti.")));
      document.head.appendChild(el);
    });
  }
  if (!w.qz) throw new Error(tr("Maktaba ya QZ Tray haipatikani."));
  qzApi = w.qz;
  return qzApi;
}

let qzConnecting: Promise<QzTrayApi> | null = null;
async function qzConnect(): Promise<QzTrayApi> {
  const qz = await loadQz();
  // Free unsigned mode: QZ Tray may ask the user to approve access.
  qz.security.setCertificatePromise((resolve) => resolve());
  qz.security.setSignaturePromise(() => (resolve) => resolve());
  if (qz.websocket.isActive()) return qz;
  if (!qzConnecting) {
    qzConnecting = qz.websocket.connect({ retries: 5, delay: 1 })
      .then(() => qz)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error ?? "");
        throw new Error(`${tr("QZ Tray haijaunganishwa. Hakikisha QZ Tray imewashwa (ikoni karibu na saa ya Windows) kisha jaribu tena.")} ${detail}`.trim());
      })
      .finally(() => { qzConnecting = null; });
  }
  return qzConnecting;
}
export async function listInstalledPrinters(): Promise<string[]> {
  const qz = await qzConnect();
  const found = await qz.printers.find();
  return (Array.isArray(found) ? found : [found]).filter(Boolean).map(String).sort((a, b) => a.localeCompare(b));
}

/** The Windows default printer (used to pre-select a printer so nobody has to type its name). */
export async function defaultInstalledPrinter(): Promise<string> {
  const qz = await qzConnect();
  try { return String((await qz.printers.getDefault?.()) ?? ""); } catch { return ""; }
}

/** Sends raw ESC/POS bytes to an installed printer through QZ Tray. Bytes are sent as base64 so nothing is altered. */
export async function printRawViaQz(printerName: string, bytes: Uint8Array) {
  const qz = await qzConnect();
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  await qz.print(qz.configs.create(printerName), [{ type: "raw", format: "command", flavor: "base64", data: btoa(binary) }]);
}
/**
 * Page options QZ Tray needs so the receipt is rendered at the REAL paper width.
 * Without them QZ uses the Windows driver's default paper (sometimes A4, sometimes 58mm), renders the HTML at that
 * width and then shrinks it ("scaleContent"), which is why a bill/order sometimes came out small.
 */
export function qzPageOptions(paper?: string) {
  const p = String(paper ?? "").toLowerCase();
  if (p === "a4") return { width: 210, height: 297, margin: 10, label: "A4" as const };
  if (p === "58mm") return { width: 58, height: 0, margin: 0, label: "58mm" as const };
  return { width: 80, height: 0, margin: 0, label: "80mm" as const };
}

/**
 * QZ Tray HTML (pixel) pageWidth is given in INCHES - the same unit as the config (see sendHtmlToQz).
 * 58mm = 2.283in, 80mm = 3.15in, A4 = 8.268in. (Passing 80 meant 80 units, passing mm-as-px clipped the receipt.)
 */
export function qzHtmlPageWidthInches(paper?: string): number {
  return Math.round((qzPageOptions(paper).width / 25.4) * 1000) / 1000;
}

/** Width the preview/measuring frame uses so it lays out exactly like the printed page (CSS 96dpi). */
function receiptWidthCssPx(paper?: string): number {
  return Math.round(qzHtmlPageWidthInches(paper) * 96);
}

/** Extra blank paper left under the last line so the cutter does not slice through the text. */
const RECEIPT_TAIL_MM = 6;

/** CSS pixels -> millimetres (96dpi), rounded up, plus a small tail. Pure function (unit-tested). */
export function receiptHeightMm(contentHeightPx: number): number {
  const px = Number.isFinite(contentHeightPx) && contentHeightPx > 0 ? contentHeightPx : 0;
  return Math.max(30, Math.ceil((px * 25.4) / 96) + RECEIPT_TAIL_MM);
}

/**
 * Renders the receipt HTML off-screen at the REAL paper width and returns how tall it really is (CSS px).
 * Roll printers (58/80mm) have no fixed page length: if the job does not say how long the receipt is, the driver
 * feeds a default page (often A4 / very long) - this is why the paper came out far too long.
 */
export async function measureReceiptHeightPx(html: string, paper?: string): Promise<number> {
  const widthPx = receiptWidthCssPx(paper);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;height:1px;border:0;visibility:hidden;`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => { frame.onload = () => resolve(); frame.srcdoc = html; });
    const doc = frame.contentDocument;
    if (!doc) return 0;
    const body = doc.body;
    const rect = body ? body.getBoundingClientRect() : { height: 0 };
    const margins = body ? parseFloat(getComputedStyle(body).marginTop || "0") + parseFloat(getComputedStyle(body).marginBottom || "0") : 0;
    return Math.max(rect.height + margins, body ? body.scrollHeight : 0, 0);
  } finally { frame.remove(); }
}

/**
 * Shows the receipt exactly as it will print (same HTML, same paper width) in a pop-up, with the real length in mm.
 * Resolves true when the person presses Print, false when they close it.
 */
export async function showReceiptPreview(html: string, paper?: string): Promise<boolean> {
  const page = qzPageOptions(paper);
  const widthPx = receiptWidthCssPx(paper);
  const heightPx = await measureReceiptHeightPx(html, paper);
  const heightMm = page.height ? page.height : receiptHeightMm(heightPx);
  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.65);display:flex;flex-direction:column;align-items:center;padding:16px;gap:12px;";
    const info = document.createElement("div");
    info.style.cssText = "color:#fff;font:600 14px system-ui,sans-serif;text-align:center;";
    info.textContent = `${tr("Hakiki ya risiti")} - ${page.label} - ${tr("Urefu")}: ${heightMm} mm`;
    const scroller = document.createElement("div");
    scroller.style.cssText = "flex:1;min-height:0;overflow:auto;width:100%;display:flex;justify-content:center;";
    const sheet = document.createElement("div");
    sheet.style.cssText = `background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.4);width:${widthPx}px;height:${Math.ceil(heightPx) + 24}px;flex:none;`;
    const frame = document.createElement("iframe");
    frame.style.cssText = `border:0;width:${widthPx}px;height:100%;background:#fff;`;
    frame.srcdoc = html;
    sheet.appendChild(frame); scroller.appendChild(sheet);
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:12px;";
    const mkBtn = (label: string, bg: string, color: string) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.style.cssText = `padding:10px 22px;border:0;border-radius:8px;font:600 14px system-ui,sans-serif;cursor:pointer;background:${bg};color:${color};`;
      return b;
    };
    const cancel = mkBtn(tr("Funga"), "#e2e8f0", "#0f172a");
    const ok = mkBtn(tr("Chapa"), "#16a34a", "#fff");
    const done = (value: boolean) => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(value); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(false); };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    document.addEventListener("keydown", onKey);
    bar.append(cancel, ok);
    overlay.append(info, scroller, bar);
    document.body.appendChild(overlay);
  });
}

const mmToIn = (mm: number) => Math.round((mm / 25.4) * 1000) / 1000;

/** Pure, testable dimensions/options shared by QZ's page config and HTML renderer. */
export function qzHtmlPrintSettings(paper: string | undefined, contentHeightPx: number) {
  const page = qzPageOptions(paper);
  const heightMm = page.height || receiptHeightMm(contentHeightPx);
  const widthIn = qzHtmlPageWidthInches(paper);
  const heightIn = mmToIn(heightMm);
  return {
    config: {
      units: "in" as const,
      size: { width: widthIn, height: heightIn },
      margins: mmToIn(page.margin),
      scaleContent: false,
      colorType: "blackwhite" as const,
      // Auto orientation avoids forcing rotation on narrow custom roll-paper pages.
      orientation: null,
      jobName: "SmartHub receipt",
    },
    pixelOptions: { pageWidth: widthIn, pageHeight: heightIn },
    widthMm: page.width,
    heightMm,
  };
}

/** Send the same HTML with explicit width and content-derived height to both QZ render layers. */
async function sendHtmlToQz(printerName: string, html: string, paper?: string) {
  const qz = await qzConnect();
  const contentHeightPx = await measureReceiptHeightPx(html, paper);
  const settings = qzHtmlPrintSettings(paper, contentHeightPx);
  const config = qz.configs.create(printerName, settings.config);
  await qz.print(config, [{
    type: "pixel",
    format: "html",
    flavor: "plain",
    data: html,
    options: settings.pixelOptions,
  }]);
}

/**
 * Print HTML directly through the configured QZ Tray printer.
 * Used for waiter/order slips that are already confirmed by the user.
 * Bills and payment receipts that require a preview use previewAndPrintViaQz below.
 */
export async function printHtmlViaQz(printerName: string, html: string, paper?: string): Promise<void> {
  if (!printerName.trim()) throw new Error(tr("Chagua printer ya QZ Tray kwenye mipangilio kwanza."));
  await sendHtmlToQz(printerName, html, paper);
}

/**
 * The ONLY way to print an HTML receipt: shows the preview of this exact `html` string, and prints that same string
 * only after the person presses Chapa. Returns false when they close the preview (nothing is sent to the printer).
 */
export async function previewAndPrintViaQz(printerName: string, html: string, paper?: string): Promise<boolean> {
  if (!(await showReceiptPreview(html, paper))) return false;
  await sendHtmlToQz(printerName, html, paper);
  return true;
}
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ Direct devices â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const BLE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

const hex = (n?: number) => (n === undefined ? "" : n.toString(16).padStart(4, "0"));

export async function pairDevice(kind: DeviceKind): Promise<DeviceInfo> {
  if (kind === "usb") {
    const usb = nav().usb;
    if (!usb) throw new Error(tr("Kivinjari hiki hakiungi mkono USB printing."));
    const d = await usb.requestDevice({ filters: [] });
    return { kind, name: d.productName || `USB ${hex(d.vendorId)}:${hex(d.productId)}`, vendorId: d.vendorId, productId: d.productId };
  }
  if (kind === "serial") {
    const serial = nav().serial;
    if (!serial) throw new Error(tr("Kivinjari hiki hakiungi mkono Serial printing."));
    const p = await serial.requestPort();
    const i = p.getInfo?.() ?? {};
    return { kind, name: i.usbVendorId ? `Serial ${hex(i.usbVendorId)}:${hex(i.usbProductId)}` : "Serial / Bluetooth (SPP)", vendorId: i.usbVendorId, productId: i.usbProductId };
  }
  const bluetooth = nav().bluetooth;
  if (!bluetooth) throw new Error(tr("Kivinjari hiki hakiungi mkono Bluetooth printing."));
  const d = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  return { kind, name: d.name || "Bluetooth printer", id: d.id };
}

/** Devices the user has already authorized in this browser (so they can be picked without pairing again). */
export async function authorizedDevices(kind: DeviceKind): Promise<DeviceInfo[]> {
  try {
    if (kind === "usb" && deviceSupport.usb() && nav().usb) {
      return (await nav().usb!.getDevices()).map((d) => ({ kind, name: d.productName || `USB ${hex(d.vendorId)}:${hex(d.productId)}`, vendorId: d.vendorId, productId: d.productId }));
    }
    if (kind === "serial" && deviceSupport.serial() && nav().serial) {
      return (await nav().serial!.getPorts()).map((p) => {
        const i = p.getInfo?.() ?? {};
        return { kind, name: i.usbVendorId ? `Serial ${hex(i.usbVendorId)}:${hex(i.usbProductId)}` : "Serial / Bluetooth (SPP)", vendorId: i.usbVendorId, productId: i.usbProductId };
      });
    }
    if (kind === "bluetooth" && deviceSupport.bluetooth() && nav().bluetooth?.getDevices) {
      return (await nav().bluetooth!.getDevices!()).map((d) => ({ kind, name: d.name || "Bluetooth printer", id: d.id }));
    }
  } catch { /* permission / unsupported */ }
  return [];
}

async function sendUsb(info: DeviceInfo, bytes: Uint8Array) {
  const usb = nav().usb;
  if (!usb) throw new Error(tr("Kivinjari hiki hakiungi mkono USB printing."));
  const dev = (await usb.getDevices()).find((d) => d.vendorId === info.vendorId && d.productId === info.productId) ?? (await usb.requestDevice({ filters: [] }));
  await dev.open();
  try {
    if (!dev.configuration) await dev.selectConfiguration(1);
    const configuration = dev.configuration;
    if (!configuration) throw new Error(tr("USB configuration ya printer haipatikani."));
    for (const iface of configuration.interfaces) {
      const alt = iface.alternates[0];
      const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (!out) continue;
      await dev.claimInterface(iface.interfaceNumber);
      await dev.transferOut(out.endpointNumber, new Uint8Array(bytes));
      await dev.releaseInterface(iface.interfaceNumber);
      return;
    }
    throw new Error(tr("Printer hii haina njia ya kupokea data (USB)."));
  } finally { await dev.close().catch(() => undefined); }
}

async function sendSerial(info: DeviceInfo, bytes: Uint8Array) {
  const serial = nav().serial;
  if (!serial) throw new Error(tr("Kivinjari hiki hakiungi mkono Serial printing."));
  const ports = await serial.getPorts();
  const port = ports.find((p) => { const i = p.getInfo?.() ?? {}; return i.usbVendorId === info.vendorId && i.usbProductId === info.productId; }) ?? ports[0] ?? (await serial.requestPort());
  await port.open({ baudRate: 9600 });
  try {
    const writable = port.writable;
    if (!writable) throw new Error(tr("Printer ya Serial haijafungua njia ya kuandika."));
    const writer = writable.getWriter();
    try { await writer.write(new Uint8Array(bytes)); } finally { writer.releaseLock(); }
  } finally { await port.close().catch(() => undefined); }
}

async function sendBluetooth(info: DeviceInfo, bytes: Uint8Array) {
  const bluetooth = nav().bluetooth;
  if (!bluetooth) throw new Error(tr("Kivinjari hiki hakiungi mkono Bluetooth printing."));
  let dev = bluetooth.getDevices ? (await bluetooth.getDevices()).find((d) => d.id === info.id) : undefined;
  if (!dev) dev = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  if (!dev.gatt) throw new Error(tr("Muunganisho wa Bluetooth haupatikani."));
  const gatt = dev.gatt;
  const server = await gatt.connect();
  try {
    for (const service of await server.getPrimaryServices()) {
      for (const ch of await service.getCharacteristics()) {
        if (!ch.properties.write && !ch.properties.writeWithoutResponse) continue;
        for (let i = 0; i < bytes.length; i += 100) {
          const chunk = bytes.slice(i, i + 100);
          if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(new Uint8Array(chunk)); else await ch.writeValue(new Uint8Array(chunk));
        }
        return;
      }
    }
    throw new Error(tr("Haikupatikana njia ya kuandika kwenye printer ya Bluetooth."));
  } finally { gatt.disconnect(); }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ Test print â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function escposTest(printerName: string, width: string) {
  const enc = new TextEncoder();
  const text = `SMARTHUB POS\n${tr("JARIBIO LA KUCHAPA")}\n--------------------------------\n${tr("Printer")}: ${printerName || "-"}\n${tr("Upana wa karatasi")}: ${width}\n${new Date().toLocaleString()}\n--------------------------------\n1234567890 ABCDEFGHIJ\n${tr("Ukisoma hii, kuchapa kunafanya kazi.")}\n\n\n`;
  return new Uint8Array([0x1b, 0x40, ...enc.encode(text), 0x1d, 0x56, 0x42, 0x00]);
}

export type PrinterSettings = { printerSource: string; receiptPrinter: string; receiptDevice?: DeviceInfo | null; paperWidth: string };

/** Where the test page went, so the screen can tell the person the truth instead of always saying "sent". */
export type TestPrintResult = { via: "direct" | "qz" };

export async function testPrinter(s: PrinterSettings): Promise<TestPrintResult> {
  if (s.printerSource === "direct") {
    const d = s.receiptDevice;
    if (!d) throw new Error(tr("Chagua au unganisha printer kwanza."));
    const bytes = escposTest(d.name, s.paperWidth);
    if (d.kind === "usb") await sendUsb(d, bytes);
    else if (d.kind === "serial") await sendSerial(d, bytes);
    else await sendBluetooth(d, bytes);
    return { via: "direct" };
  }
  if (!s.receiptPrinter) throw new Error(tr("Chagua printer ya QZ Tray kwenye mipangilio kwanza."));
  await printRawViaQz(s.receiptPrinter, escposTest(s.receiptPrinter, s.paperWidth));
  return { via: "qz" };
}
