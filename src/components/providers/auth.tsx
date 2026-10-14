import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { AuthContext } from "./auth-context.ts";

const authority = import.meta.env.VITE_OIDC_AUTHORITY || import.meta.env.VITE_HERCULES_OIDC_AUTHORITY || "";
const clientId = import.meta.env.VITE_OIDC_CLIENT_ID || import.meta.env.VITE_HERCULES_OIDC_CLIENT_ID || "";
const manager = authority && clientId ? new UserManager({
  authority,
  client_id: clientId,
  response_type: "code",
  scope: import.meta.env.VITE_OIDC_SCOPE || "openid profile email offline_access",
  redirect_uri: import.meta.env.VITE_OIDC_REDIRECT_URI || `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
}) : null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(Boolean(manager));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    if (!manager) return;
    manager.getUser()
      .then((currentUser) => { if (active) setUser(currentUser); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause : new Error(String(cause))); })
      .finally(() => { if (active) setLoading(false); });
    const expired = () => setUser(null);
    manager.events.addUserSignedOut(expired);
    return () => {
      active = false;
      manager.events.removeUserSignedOut(expired);
    };
  }, []);

  const signin = useCallback(async () => {
    if (!manager) throw new Error("Weka VITE_OIDC_AUTHORITY na VITE_OIDC_CLIENT_ID kwenye .env.local kabla ya kuingia.");
    await manager.signinRedirect();
  }, []);

  const signout = useCallback(async () => {
    if (manager) await manager.signoutRedirect();
    else setUser(null);
  }, []);

  const completeSignIn = useCallback(async () => {
    if (!manager) throw new Error("OIDC haijasanidiwa. Weka VITE_OIDC_AUTHORITY na VITE_OIDC_CLIENT_ID.");
    setLoading(true);
    try {
      setUser(await manager.signinRedirectCallback());
      setError(null);
    } catch (cause) {
      const authError = cause instanceof Error ? cause : new Error(String(cause));
      setError(authError);
      throw authError;
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo(() => ({
    user,
    isLoading,
    isAuthenticated: Boolean(user && !user.expired),
    error,
    signin,
    signout,
    completeSignIn,
  }), [user, isLoading, error, signin, signout, completeSignIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
