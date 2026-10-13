/**
 * Browser side of fingerprint / Face ID / Windows Hello sign-in (WebAuthn platform authenticators).
 * Needs HTTPS (or localhost) and a device with a fingerprint reader, Face ID, Windows Hello or Android biometrics.
 */
import { tr } from "./i18n.ts";

export const toB64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64u = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export function biometricSupported() {
  return typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials;
}
export async function platformBiometricAvailable() {
  try { return biometricSupported() && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

/** Turns browser WebAuthn errors into a short message in the system language. */
export function biometricError(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return new Error(tr("Uthibitisho umeghairiwa au muda umeisha. Jaribu tena."));
  if (name === "InvalidStateError") return new Error(tr("Kifaa hiki tayari kimesajiliwa kwa mfanyakazi huyu."));
  if (name === "NotSupportedError" || name === "SecurityError") return new Error(tr("Kifaa au kivinjari hiki hakitumii alama ya kidole/uso. Tumia HTTPS na kivinjari cha kisasa."));
  return e instanceof Error ? e : new Error(tr("Uthibitisho wa alama umeshindikana."));
}

export async function createCredential(challenge: string, employee: { id: string; name: string; code: string }, exclude: string[]) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(challenge) as BufferSource,
      rp: { name: "SmartHubPOS", id: window.location.hostname },
      user: { id: new TextEncoder().encode(employee.id), name: employee.code, displayName: employee.name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      excludeCredentials: exclude.map((id) => ({ type: "public-key" as const, id: fromB64u(id) as BufferSource })),
      attestation: "none",
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error(tr("Uthibitisho umeghairiwa au muda umeisha. Jaribu tena."));
  const res = cred.response as AuthenticatorAttestationResponse;
  const key = res.getPublicKey?.();
  if (!key) throw new Error(tr("Kifaa hiki hakitoi ufunguo wa umma. Tumia kivinjari cha kisasa (Chrome, Edge, Safari)."));
  return { credentialId: toB64u(cred.rawId), publicKey: toB64u(key), algorithm: res.getPublicKeyAlgorithm(), clientDataJSON: toB64u(res.clientDataJSON) };
}

export async function getAssertion(challenge: string, allowIds: string[] = []) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge) as BufferSource,
      rpId: window.location.hostname,
      userVerification: "required",
      allowCredentials: allowIds.map((id) => ({ type: "public-key" as const, id: fromB64u(id) as BufferSource })),
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error(tr("Uthibitisho umeghairiwa au muda umeisha. Jaribu tena."));
  const res = cred.response as AuthenticatorAssertionResponse;
  return { credentialId: toB64u(cred.rawId), authenticatorData: toB64u(res.authenticatorData), clientDataJSON: toB64u(res.clientDataJSON), signature: toB64u(res.signature) };
}
