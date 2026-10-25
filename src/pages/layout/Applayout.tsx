import { useIsMobile } from "@/hooks/use-mobile.ts";
import { Navigate, Outlet, useNavigate, useLocation } from "react-router-dom";
import { MODULES } from "@/convex/permissions";
import { Suspense, useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ChangePasswordForm } from "@/pages/maintenance/SecurityPage.tsx";
import { api } from "@/convex/_generated/api.js";
import { SignInButton } from "@/components/ui/signin.tsx";
import Sidebar from "./_components/sidebar.tsx";
import TopBar from "./_components/TopBar.tsx";
import { tr, setLang } from "@/lib/i18n.ts";
import BusinessPicker from "@/pages/super-admin/BusinessPicker.tsx";
import { PICK_BUSINESS_FLAG } from "@/lib/business-session.ts";
import AnnouncementPopup from "@/components/announcement-popup.tsx";
import ErrorBoundary from "@/components/error-boundary.tsx";
import SubscriptionBanner from "./_components/SubscriptionBanner.tsx";

function LoadingScreen() {
  return <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950 text-white" role="status" aria-live="polite">
    <div className="h-11 w-11 rounded-full border-4 border-white/20 border-t-cyan-400 animate-spin" />
    <p className="text-sm text-blue-100">{tr("Inaandaa SmartHubPOS, tafadhali subiri…")}</p>
  </div>;
}

/** Signs the user out after `minutes` without keyboard/mouse/touch activity (0 = disabled). */
function useIdleSignOut(enabled: boolean, minutes: number) {
  const { signOut } = useAuthActions();
  useEffect(() => {
    if (!enabled || !(minutes > 0)) return;
    let timer = window.setTimeout(() => void signOut(), minutes * 60_000);
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void signOut(), minutes * 60_000); };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [enabled, minutes, signOut]);
}

export default function AppLayout() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
  const business = useQuery(api.tenants.current, isAuthenticated ? {} : "skip");
  const exitBusiness = useMutation(api.tenants.exitBusiness);
  // Right after sign-in a Super Admin always starts at the business picker.
  const [resetting, setResetting] = useState(() => { try { return window.sessionStorage.getItem(PICK_BUSINESS_FLAG) === "1"; } catch { return false; } });
  useEffect(() => {
    if (!resetting || !isAuthenticated || !user) return;
    let cancelled = false;
    exitBusiness({}).catch(() => undefined).finally(() => {
      try { window.sessionStorage.removeItem(PICK_BUSINESS_FLAG); } catch { /* ignore */ }
      if (!cancelled) setResetting(false);
    });
    return () => { cancelled = true; };
  }, [resetting, isAuthenticated, user, exitBusiness]);
  const settings = useQuery(api.maintenance.getSettings, isAuthenticated && user && !user.requirePasswordChange && business && !business.suspended && !business.needsPicker ? {} : "skip");
  const securitySettings = settings?.app.security as unknown;
  const timeoutValue = typeof securitySettings === "object" && securitySettings !== null && "sessionTimeoutMinutes" in securitySettings
    ? securitySettings.sessionTimeoutMinutes
    : 30;
  const timeout = Number(timeoutValue ?? 30);
  useIdleSignOut(isAuthenticated && !!user, timeout);
  // ONE language for the whole system: the language saved for the business (default Kiswahili).
  useEffect(() => {
    if (!settings) return;
    const languageSettings = settings.app.language as unknown;
    const language = typeof languageSettings === "object" && languageSettings !== null && "language" in languageSettings
      ? languageSettings.language
      : undefined;
    setLang(language === "en" ? "en" : "sw");
  }, [settings]);

  // Mobile navigation closes the sidebar through Sidebar.onNavigate; avoid a post-render state update effect.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/", { replace: true, state: { from: location.pathname } });
  }, [isLoading, isAuthenticated, navigate, location.pathname]);

  if (isLoading || (isAuthenticated && (user === undefined || business === undefined)) || resetting) return <LoadingScreen />;
  if (!isAuthenticated) return <LoadingScreen />;
  if (user === null) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl"><h1 className="text-xl font-bold">{tr("Tunamalizia akaunti yako…")}</h1><p className="mt-2 text-sm text-slate-300">{tr("Ikiwa ukurasa huu hautabadilika, jaribu kutoka na kuingia tena.")}</p><div className="mt-5"><SignInButton /></div></div></div>;

  if (user?.requirePasswordChange) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5"><div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-2xl"><h1 className="text-xl font-bold">{tr("Badilisha password yako")}</h1><p className="text-sm text-muted-foreground">{tr("Kwa usalama, lazima ubadilishe password ya kuanzia kabla ya kuendelea.")}</p><ChangePasswordForm /></div></div>;

  if (business?.suspended) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl"><h1 className="text-xl font-bold">{tr("Biashara yako imesimamishwa")}</h1><p className="mt-2 text-sm text-slate-300">{tr("Wasiliana na Super Admin ili iwashwe tena.")}</p><div className="mt-5"><SignInButton /></div></div></div>;
  if (business?.expired) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl"><h1 className="text-xl font-bold">{business.subscription?.plan === "demo" ? tr("Muda wa demo umeisha") : tr("Usajili wa biashara yako umeisha")}</h1><p className="mt-2 text-sm text-slate-300">{tr("Wasiliana na SmartHub ili ulipie uendelee kutumia mfumo. Data yako yote iko salama.")}</p><div className="mt-5"><SignInButton /></div></div></div>;
  if (business?.needsPicker) return <BusinessPicker />;

  // A screen whose module is not available to this business/user is never shown, even when its address is typed in by hand.
  // Selling Point staff (waiter / waitress) never open the Dashboard: they start at, and are sent back to, Selling Point.
  const sellingStaff = ["waiter", "waitress"].includes(String(user?.role ?? "").toLowerCase());
  if (sellingStaff && (location.pathname === "/dashboard" || location.pathname.startsWith("/dashboard/"))) return <Navigate to="/selling-point" replace />;
  const moduleOfRoute = MODULES.find((m) => m.path === "/" + (location.pathname.split("/")[1] ?? ""));
  const blocked = !!moduleOfRoute && !!business?.modules && !business.modules.includes(moduleOfRoute.key);

  return <div className="app-bg flex h-dvh overflow-hidden">
    {isMobile && sidebarOpen && <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
    <Sidebar open={sidebarOpen} mobile={isMobile} onNavigate={() => { if (isMobile) setSidebarOpen(false); }} onToggle={() => setSidebarOpen((o) => !o)} />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TopBar onMenuToggle={() => setSidebarOpen((o) => !o)} />
      <SubscriptionBanner />
      <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">{blocked ? <Navigate to={sellingStaff ? "/selling-point" : "/dashboard"} replace /> : <ErrorBoundary resetKey={location.pathname}><Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite"><div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" /></div>}><Outlet /></Suspense></ErrorBoundary>}</main>
    </div>
    <AnnouncementPopup />
  </div>;
}
