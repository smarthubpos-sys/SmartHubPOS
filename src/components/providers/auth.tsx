import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";

type AuthValue = { user: User | null; isLoading: boolean; isAuthenticated: boolean; error: Error | null; signin: () => Promise<void>; signout: () => Promise<void>; completeSignIn: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);
const authority = import.meta.env.VITE_OIDC_AUTHORITY || import.meta.env.VITE_HERCULES_OIDC_AUTHORITY || "";
const clientId = import.meta.env.VITE_OIDC_CLIENT_ID || import.meta.env.VITE_HERCULES_OIDC_CLIENT_ID || "";
const manager = authority && clientId ? new UserManager({ authority, client_id: clientId, response_type: "code", scope: import.meta.env.VITE_OIDC_SCOPE || "openid profile email offline_access", redirect_uri: import.meta.env.VITE_OIDC_REDIRECT_URI || `${window.location.origin}/auth/callback`, post_logout_redirect_uri: window.location.origin, userStore: new WebStorageStateStore({ store: window.sessionStorage }) }) : null;
export function AuthProvider({ children }: { children: React.ReactNode }) {
 const [user,setUser]=useState<User|null>(null); const [isLoading,setLoading]=useState(true); const [error,setError]=useState<Error|null>(null);
 useEffect(()=>{ let active=true; if(!manager){setLoading(false); return;} manager.getUser().then(u=>{if(active)setUser(u)}).catch(e=>{if(active)setError(e instanceof Error?e:new Error(String(e)))}).finally(()=>{if(active)setLoading(false)}); const expired=()=>setUser(null); manager.events.addUserSignedOut(expired); return()=>{active=false;manager.events.removeUserSignedOut(expired)};},[]);
 const signin=useCallback(async()=>{if(!manager) throw new Error("Weka VITE_OIDC_AUTHORITY na VITE_OIDC_CLIENT_ID kwenye .env.local kabla ya kuingia."); await manager.signinRedirect();},[]);
 const signout=useCallback(async()=>{if(manager) await manager.signoutRedirect(); else setUser(null);},[]);
 const completeSignIn=useCallback(async()=>{if(!manager) throw new Error("OIDC haijasanidiwa. Weka VITE_OIDC_AUTHORITY na VITE_OIDC_CLIENT_ID."); setLoading(true); try{setUser(await manager.signinRedirectCallback());setError(null)}catch(e){setError(e instanceof Error?e:new Error(String(e)));throw e}finally{setLoading(false)}},[]);
 const value=useMemo(()=>({user,isLoading,isAuthenticated:!!user&&!user.expired,error,signin,signout,completeSignIn}),[user,isLoading,error,signin,signout,completeSignIn]);
 return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAppAuth(){const v=useContext(AuthContext);if(!v)throw new Error("useAppAuth must be used inside AuthProvider");return v;}
