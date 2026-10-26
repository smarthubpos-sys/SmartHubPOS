import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PIN_PATTERN, pinLookupKey, verifyStaffPin } from "./pinCrypto";

/**
 * Username/password sign-in implemented on Convex Auth.
 * Convex Auth's built-in Password provider uses an email-shaped account key;
 * we map usernames to a reserved, non-deliverable internal domain.
 * No email is sent and no external OIDC provider is involved.
 */
const INTERNAL_LOGIN_DOMAIN = "login.smarthub.invalid";

function normalizeUsername(value: unknown) {
  const username = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error("Jina la mtumiaji liwe herufi/namba 3–32, bila nafasi.");
  }
  return username;
}

export const {
  auth,
  signIn,
  signOut,
  store,
  isAuthenticated,
} = convexAuth({
  providers: [
    ConvexCredentials({
      id: "staffPin",
      // PIN only: the PIN is the whole credential and it identifies the person. A PIN belongs to exactly one person system-wide;
      // if a PIN ever matched two people (old data) nobody signs in with it until an administrator gives one of them a new PIN.
      authorize: async (credentials, ctx) => {
        const pin = String(credentials.pin ?? "");
        if (!PIN_PATTERN.test(pin)) return null;
        const now = Date.now();
        const state = await ctx.runQuery(internal.maintenance.pinLoginState, { now });
        if (state.locked) return null; // too many wrong PINs system-wide: PIN sign-in is paused for a few minutes (password sign-in still works)
        const lookup = await pinLookupKey(pin);
        let matched: Id<"users"> | null = null;
        const owners = await ctx.runQuery(internal.maintenance.findPinOwners, { lookup });
        if (owners.length === 1) {
          const [owner] = owners;
          if (!owner.pinHash || await verifyStaffPin(pin, owner.pinHash)) matched = owner.userId;
        } else if (owners.length === 0) {
          const legacy = await ctx.runQuery(internal.maintenance.legacyPinUsers, {});
          const hits: Id<"users">[] = [];
          for (const candidate of legacy.users) if (await verifyStaffPin(pin, candidate.pinHash)) hits.push(candidate.userId);
          if (hits.length === 1) matched = hits[0];
          else if (legacy.done) await ctx.runMutation(internal.maintenance.markLegacyPinsDone, {});
        }
        const accepted = await ctx.runMutation(internal.maintenance.recordPinLogin, { userId: matched ?? undefined, success: matched !== null, now, upgradeLookup: matched ? lookup : undefined });
        return accepted && matched ? { userId: matched } : null;
      },
    }),
    Password({
      profile(params) {
        const emailValue = String(params.email ?? "").trim().toLowerCase();
        const emailUsername = emailValue.endsWith(`@${INTERNAL_LOGIN_DOMAIN}`)
          ? emailValue.slice(0, -(`@${INTERNAL_LOGIN_DOMAIN}`).length)
          : undefined;
        const username = normalizeUsername(params.username ?? emailUsername);
        // During initial provisioning, only the configured initial administrator
        // username may create an account. Other accounts must be provisioned by
        // the system administrator once user management is enabled.
        if (params.flow === "signUp") {
          const initialAdmin = (process.env.SUPER_ADMIN_USERNAME ?? "").trim().toLowerCase();
          if (!initialAdmin) {
            throw new Error("Msimamizi lazima aweke SUPER_ADMIN_USERNAME kwenye Convex kwanza.");
          }
          if (username !== initialAdmin) {
            throw new Error("Usajili umefungwa. Wasiliana na Super Admin.");
          }
        }
        return {
          username,
          name: username,
          email: `${username}@${INTERNAL_LOGIN_DOMAIN}`,
        };
      },
      validatePasswordRequirements(password) {
        if (password.length < 10) {
          throw new Error("Nenosiri lazima liwe na angalau herufi 10.");
        }
      },
    }),
  ],
});
