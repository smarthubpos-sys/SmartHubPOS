import { beforeEach, describe, expect, it } from "vitest";
import { clearActivity, idleLimitMinutes, isIdleExpired, markActivity, purgeLegacyTokens, sessionTokenStorage } from "./session-security.ts";

describe("session security", () => {
  beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

  it("keeps the login token per tab (sessionStorage) and never in localStorage", () => {
    sessionTokenStorage.setItem("__convexAuthJWT_x", "secret");
    expect(window.sessionStorage.getItem("__convexAuthJWT_x")).toBe("secret");
    expect(window.localStorage.getItem("__convexAuthJWT_x")).toBeNull();
    sessionTokenStorage.removeItem("__convexAuthJWT_x");
    expect(sessionTokenStorage.getItem("__convexAuthJWT_x")).toBeNull();
  });

  it("removes tokens older versions saved permanently, and nothing else", () => {
    window.localStorage.setItem("__convexAuthJWT_abc", "old");
    window.localStorage.setItem("__convexAuthRefreshToken_abc", "old");
    window.localStorage.setItem("smarthub-print-paper", "58mm");
    purgeLegacyTokens();
    expect(window.localStorage.getItem("__convexAuthJWT_abc")).toBeNull();
    expect(window.localStorage.getItem("__convexAuthRefreshToken_abc")).toBeNull();
    expect(window.localStorage.getItem("smarthub-print-paper")).toBe("58mm");
  });

  it("signs out after the idle limit, also when the device slept (timestamp based), and distrusts a missing clock", () => {
    expect(isIdleExpired(15)).toBe(true); // no clock recorded: restored session is not trusted
    markActivity();
    expect(isIdleExpired(15)).toBe(false);
    expect(isIdleExpired(15, Date.now() + 14 * 60_000)).toBe(false);
    expect(isIdleExpired(15, Date.now() + 16 * 60_000)).toBe(true);
    clearActivity();
    expect(isIdleExpired(15)).toBe(true);
  });

  it("caps the Super Admin at 10 minutes and ignores 'disabled' for that account", () => {
    expect(idleLimitMinutes(30, true)).toBe(10);
    expect(idleLimitMinutes(0, true)).toBe(10);
    expect(idleLimitMinutes(5, true)).toBe(5);
    expect(idleLimitMinutes(30, false)).toBe(30);
    expect(idleLimitMinutes(0, false)).toBe(0);
  });
});
