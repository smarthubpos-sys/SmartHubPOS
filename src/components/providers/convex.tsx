import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { purgeLegacyTokens, sessionTokenStorage } from "@/lib/session-security.ts";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = new ConvexReactClient(convexUrl || "https://example.invalid");
purgeLegacyTokens(); // tokens saved permanently by older versions must not keep anybody signed in

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  // Login token is kept per tab (sessionStorage), never permanently on the device.
  return <ConvexAuthProvider client={convex} storage={sessionTokenStorage}>{children}</ConvexAuthProvider>;
}
