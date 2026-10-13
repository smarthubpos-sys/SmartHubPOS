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

const nav = () => navigator as any;
export const deviceSupport = {
  usb: () => typeof navigator !== "undefined" && !!nav().usb,
  serial: () => typeof navigator !== "undefined" && !!nav().serial,
  bluetooth: () => typeof navigator !== "undefined" && !!nav().bluetooth,
};

/* ───────── Installed printers (QZ Tray) ───────── */
async function qzConnect() {
  const mod: any = await import("qz-tray");
  const qz = mod.default ?? mod;
  qz.security.setCertificatePromise((resolve: () => void) => resolve());
  qz.security.setSignaturePromise(() => (resolve: () => void) => resolve());
  if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 0, delay: 0 });
  return qz;
}

export async function listInstalledPrinters(): Promise<string[]> {
  const qz = await qzConnect();
  const found = await qz.printers.find();
  return (Array.isArray(found) ? found : [found]).filter(Boolean).map(String).sort((a, b) => a.localeCompare(b));
}

/* ───────── Direct devices ───────── */
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
    const d = await nav().usb.requestDevice({ filters: [] });
    return { kind, name: d.productName || `USB ${hex(d.vendorId)}:${hex(d.productId)}`, vendorId: d.vendorId, productId: d.productId };
  }
  if (kind === "serial") {
    const p = await nav().serial.requestPort();
    const i = p.getInfo?.() ?? {};
    return { kind, name: i.usbVendorId ? `Serial ${hex(i.usbVendorId)}:${hex(i.usbProductId)}` : "Serial / Bluetooth (SPP)", vendorId: i.usbVendorId, productId: i.usbProductId };
  }
  const d = await nav().bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  return { kind, name: d.name || "Bluetooth printer", id: d.id };
}

/** Devices the user has already authorized in this browser (so they can be picked without pairing again). */
export async function authorizedDevices(kind: DeviceKind): Promise<DeviceInfo[]> {
  try {
    if (kind === "usb" && deviceSupport.usb()) {
      return (await nav().usb.getDevices()).map((d: any) => ({ kind, name: d.productName || `USB ${hex(d.vendorId)}:${hex(d.productId)}`, vendorId: d.vendorId, productId: d.productId }));
    }
    if (kind === "serial" && deviceSupport.serial()) {
      return (await nav().serial.getPorts()).map((p: any) => {
        const i = p.getInfo?.() ?? {};
        return { kind, name: i.usbVendorId ? `Serial ${hex(i.usbVendorId)}:${hex(i.usbProductId)}` : "Serial / Bluetooth (SPP)", vendorId: i.usbVendorId, productId: i.usbProductId };
      });
    }
    if (kind === "bluetooth" && deviceSupport.bluetooth() && nav().bluetooth.getDevices) {
      return (await nav().bluetooth.getDevices()).map((d: any) => ({ kind, name: d.name || "Bluetooth printer", id: d.id }));
    }
  } catch { /* permission / unsupported */ }
  return [];
}

async function sendUsb(info: DeviceInfo, bytes: Uint8Array) {
  const dev = (await nav().usb.getDevices()).find((d: any) => d.vendorId === info.vendorId && d.productId === info.productId) ?? (await nav().usb.requestDevice({ filters: [] }));
  await dev.open();
  try {
    if (!dev.configuration) await dev.selectConfiguration(1);
    for (const iface of dev.configuration.interfaces) {
      const alt = iface.alternates[0];
      const out = alt.endpoints.find((e: any) => e.direction === "out" && e.type === "bulk");
      if (!out) continue;
      await dev.claimInterface(iface.interfaceNumber);
      await dev.transferOut(out.endpointNumber, bytes);
      await dev.releaseInterface(iface.interfaceNumber);
      return;
    }
    throw new Error(tr("Printer hii haina njia ya kupokea data (USB)."));
  } finally { await dev.close().catch(() => undefined); }
}

async function sendSerial(info: DeviceInfo, bytes: Uint8Array) {
  const ports = await nav().serial.getPorts();
  const port = ports.find((p: any) => { const i = p.getInfo?.() ?? {}; return i.usbVendorId === info.vendorId && i.usbProductId === info.productId; }) ?? ports[0] ?? (await nav().serial.requestPort());
  await port.open({ baudRate: 9600 });
  try {
    const writer = port.writable.getWriter();
    await writer.write(bytes);
    writer.releaseLock();
  } finally { await port.close().catch(() => undefined); }
}

async function sendBluetooth(info: DeviceInfo, bytes: Uint8Array) {
  let dev = nav().bluetooth.getDevices ? (await nav().bluetooth.getDevices()).find((d: any) => d.id === info.id) : undefined;
  if (!dev) dev = await nav().bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  const server = await dev.gatt.connect();
  try {
    for (const service of await server.getPrimaryServices()) {
      for (const ch of await service.getCharacteristics()) {
        if (!ch.properties.write && !ch.properties.writeWithoutResponse) continue;
        for (let i = 0; i < bytes.length; i += 100) {
          const chunk = bytes.slice(i, i + 100);
          if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(chunk); else await ch.writeValue(chunk);
        }
        return;
      }
    }
    throw new Error(tr("Haikupatikana njia ya kuandika kwenye printer ya Bluetooth."));
  } finally { dev.gatt.disconnect(); }
}

/* ───────── Test print ───────── */
function escposTest(printerName: string, width: string) {
  const enc = new TextEncoder();
  const text = `SMARTHUB POS\n${tr("JARIBIO LA KUCHAPA")}\n--------------------------------\n${tr("Printer")}: ${printerName || "-"}\n${tr("Upana wa karatasi")}: ${width}\n${new Date().toLocaleString()}\n--------------------------------\n1234567890 ABCDEFGHIJ\n${tr("Ukisoma hii, kuchapa kunafanya kazi.")}\n\n\n`;
  return new Uint8Array([0x1b, 0x40, ...enc.encode(text), 0x1d, 0x56, 0x42, 0x00]);
}

function browserTestPrint(width: string, name: string) {
  const w = window.open("", "_blank", "width=420,height=600");
  if (!w) throw new Error(tr("Kivinjari kimezuia dirisha la kuchapa. Ruhusu pop-ups."));
  const px = width === "58mm" ? "58mm" : "80mm";
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  w.document.write(`<html><head><title>${esc(tr("JARIBIO LA KUCHAPA"))}</title><style>@page{margin:0}body{font-family:monospace;width:${px};margin:0;padding:4mm;font-size:12px}</style></head><body><center><b>SMARTHUB POS</b><br/>${esc(tr("JARIBIO LA KUCHAPA"))}</center><hr/>${esc(tr("Printer"))}: ${esc(name || tr("(chaguo-msingi ya mfumo)"))}<br/>${esc(tr("Upana wa karatasi"))}: ${esc(width)}<br/>${new Date().toLocaleString()}<hr/>1234567890 ABCDEFGHIJ<br/>${esc(tr("Ukisoma hii, kuchapa kunafanya kazi."))}<br/><br/></body></html>`);
  w.document.close(); w.focus(); w.print();
}

export type PrinterSettings = { printerSource: string; receiptPrinter: string; receiptDevice?: DeviceInfo | null; paperWidth: string };

export async function testPrinter(s: PrinterSettings) {
  if (s.printerSource === "direct") {
    const d = s.receiptDevice;
    if (!d) throw new Error(tr("Chagua au unganisha printer kwanza."));
    const bytes = escposTest(d.name, s.paperWidth);
    if (d.kind === "usb") return sendUsb(d, bytes);
    if (d.kind === "serial") return sendSerial(d, bytes);
    return sendBluetooth(d, bytes);
  }
  if (s.receiptPrinter) {
    try {
      const qz = await qzConnect();
      await qz.print(qz.configs.create(s.receiptPrinter), [{ type: "raw", format: "plain", data: new TextDecoder().decode(escposTest(s.receiptPrinter, s.paperWidth)) }]);
      return;
    } catch { /* QZ Tray not running: fall back to the browser print dialog */ }
  }
  browserTestPrint(s.paperWidth, s.receiptPrinter);
}
