/** PIN hashing helpers. PINs are never stored as plain text. */
const ITERATIONS = 120_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hashStaffPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

export async function verifyStaffPin(pin: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, iterationsText, saltText, expectedText] = encoded.split("$");
    const iterations = Number(iterationsText);
    if (algorithm !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 100_000 || !saltText || !expectedText) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64(saltText), iterations }, key, 256);
    const actual = new Uint8Array(bits);
    const expected = fromBase64(expectedText);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

/** Staff PINs are 4 to 6 digits. */
export const PIN_PATTERN = /^\d{4,6}$/;

/**
 * Keyed one-way fingerprint of a PIN (HMAC-SHA-256). Same PIN -> same fingerprint, so the system can find the owner of a PIN
 * and refuse a PIN that somebody else already uses. The key is PIN_LOOKUP_SECRET, or (when not set) the Convex Auth signing key
 * that every deployment already has; the fingerprint is never shown to anyone. Changing that key means every PIN must be set again.
 */
export async function pinLookupKey(pin: string): Promise<string> {
  const secret = process.env.PIN_LOOKUP_SECRET || process.env.JWT_PRIVATE_KEY;
  if (!secret) throw new Error("Seva haina PIN_LOOKUP_SECRET wala JWT_PRIVATE_KEY; wasiliana na msimamizi wa mfumo.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`smarthub-staff-pin:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(pin)));
  let hex = "";
  for (const b of sig) hex += b.toString(16).padStart(2, "0");
  return hex;
}
