import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { internal } from "./_generated/api";
import { verifyStaffPin } from "./pinCrypto";

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
      authorize: async (credentials, ctx) => {
        const username = String(credentials.username ?? "").trim().toLowerCase();
        const pin = String(credentials.pin ?? "");
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || !/^\d{4}$/.test(pin)) return null;
        const record = await ctx.runQuery(internal.maintenance.staffPinRecord, { username });
        if (!record || record.isActive !== true || record.pinLoginEnabled !== true || !record.pinHash) return null;
        const now = Date.now();
        if ((record.pinLockedUntil ?? 0) > now) return null;
        const valid = await verifyStaffPin(pin, record.pinHash);
        const accepted = await ctx.runMutation(internal.maintenance.recordStaffPinAttempt, {
          userId: record.userId, expectedPinHash: record.pinHash, success: valid, now,
        });
        return accepted ? { userId: record.userId } : null;
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
