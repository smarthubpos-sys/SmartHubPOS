/**
 * Pure rules for receipt printing, kept free of React so they can be tested.
 * Printing happens AFTER a sale is saved and never calls the save mutation again, so a failed or repeated print can never create a second sale.
 */

/** Token passed to the receipt sheet after a successful save. 0 = do not auto-print. A new positive token = print once. */
export function tokenAfterSave(current: number, autoPrintEnabled: boolean): number {
  return autoPrintEnabled ? current + 1 : 0;
}

/** A manual "print" click always asks for a fresh token so it prints exactly once more. */
export function tokenForManualPrint(current: number): number {
  return current + 1;
}

/** Whether the sheet should schedule a print now: data loaded, user allowed, a positive token that was not printed yet. */
export function shouldSchedulePrint(s: { dataReady: boolean; allowed: boolean; token: number; lastPrinted: number }): boolean {
  return s.dataReady && s.allowed && s.token > 0 && s.token !== s.lastPrinted;
}

export type PaperChoice = "58mm" | "80mm" | "A4";
/** Hardware Settings store "58mm" | "80mm" | "a4"; anything unknown falls back to 80mm. */
export function paperFromSetting(value: unknown): PaperChoice {
  const v = String(value ?? "").toLowerCase();
  return v === "a4" ? "A4" : v === "58mm" ? "58mm" : "80mm";
}
