/**
 * Barcode scanner (keyboard wedge): a scanner "types" the whole code in a few milliseconds and then sends Enter (or Tab).
 * This tells a scan apart from a person typing, so a scan is picked up even when no box has the cursor.
 */
export const SCAN_MAX_GAP_MS = 80; // longer than this between two characters = a human typing
export const SCAN_MIN_LENGTH = 3;

export type ScanBuffer = { push(key: string, now: number, editableTarget: boolean): string | null; reset(): void };

export function createScanBuffer(suffix: "Enter" | "Tab" = "Enter"): ScanBuffer {
  let buf = "";
  let last = 0;
  return {
    reset() { buf = ""; last = 0; },
    push(key, now, editableTarget) {
      if (editableTarget) { buf = ""; return null; } // typing inside a box is never taken as a scan here
      if (key === suffix) {
        const code = buf.trim();
        buf = "";
        return code.length >= SCAN_MIN_LENGTH ? code : null;
      }
      if (key.length !== 1) { if (key !== "Shift" && key !== "CapsLock") buf = ""; return null; }
      if (buf && now - last > SCAN_MAX_GAP_MS) buf = "";
      buf += key;
      last = now;
      return null;
    },
  };
}

export const scannerSuffix = (v: unknown): "Enter" | "Tab" => (String(v ?? "").toLowerCase() === "tab" ? "Tab" : "Enter");
