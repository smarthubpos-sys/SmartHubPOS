/**
 * A spreadsheet runs a cell that begins with = + - or @ (or a tab / line break) as a FORMULA. A customer, supplier or item name typed by staff
 * could then run commands or send data out when someone opens the exported file ("CSV / Excel injection"). Such text gets a leading apostrophe,
 * so it is shown as plain text. Numbers, and text that is only a number ("-1,500", "+255..."), are never touched.
 */
export function safeCell<T>(value: T): T | string {
  if (typeof value !== "string" || value === "") return value;
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !/^[+-]?[\d.,\s]+%?$/.test(value)) return `'${value}`;
  return value;
}
