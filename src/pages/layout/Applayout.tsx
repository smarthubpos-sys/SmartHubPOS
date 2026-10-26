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
import { scrollAppToTop } from "@/lib/app-scroll.ts";
import BusinessPicker from "@/pages/super-admin/BusinessPicker.tsx";
import { PICK_BUSINESS_FLAG } from "@/lib/business-session.ts";
import { clearActivity, idleLimitMinutes, isIdleExpired, markActivity } from "@/lib/session-security.ts";
import AnnouncementPopup from "@/components/announcement-popup.tsx";
import ErrorBoundary from "@/components/error-boundary.tsx";
import SubscriptionBanner from "./_components/SubscriptionBanner.tsx";
import { isSellingStaffRole, routeAccess } from "@/lib/selling-point-access.ts";

function LoadingScreen() {
  return <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950 text-white" role="status" aria-live="polite">
    <div className="h-11 w-11 rounded-full border-4 border-white/20 border-t-cyan-400 animate-spin" />
    <p className="text-sm text-blue-100">{tr("Inaandaa SmartHubPOS, tafadhali subiri…")}</p>
  </div>;
}

/**
 * Signs the user out after `minutes` without keyboard/mouse/touch activity (0 = disabled).
 * The clock is a timestamp, so a tablet that was locked / asleep (timers frozen) is still signed out the moment it wakes up.
 */
function useIdleSignOut(enabled: boolean, minutes: number) {
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled || !(minutes > 0)) return;
    const leave = () => {
      clearActivity();
      try { window.sessionStorage.removeItem(PICK_BUSINESS_FLAG); } catch { /* ignore */ }
      void signOut().finally(() => navigate("/", { replace: true }));
    };
    // A session that was restored (browser reopened, tab restored) with a stale or missing clock is not trusted.
    if (isIdleExpired(minutes)) { leave(); return; }
    markActivity();
    let lastWrite = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite > 5_000) { lastWrite = now; markActivity(); }
    };
    const check = () => { if (isIdleExpired(minutes)) leave(); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 15_000);
    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [enabled, minutes, signOut, navigate]);
}

export default function AppLayout() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
  const business = useQuery(api.tenants.current, isAuthenticated ? {} : "skip");
  const permissions = useQuery(api.maintenance.myPermissions, isAuthenticated ? {} : "skip"); // undefined while loading: never treated as "no permissions"
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
    : 15;
  const timeout = idleLimitMinutes(Number(timeoutValue ?? 15), user?.role === "super_admin");
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

  // <main> is the scroll container and stays mounted between pages, so it keeps its scroll offset: start every page at its top.
  useEffect(() => { scrollAppToTop(); }, [location.pathname]);

  if (isLoading || (isAuthenticated && (user === undefined || business === undefined)) || resetting) return <LoadingScreen />;
  if (!isAuthenticated) return <LoadingScreen />;
  if (user === null) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl"><h1 className="text-xl font-bold">{tr("Tunamalizia akaunti yako…")}</h1><p className="mt-2 text-sm text-slate-300">{tr("Ikiwa ukurasa huu hautabadilika, jaribu kutoka na kuingia tena.")}</p><div className="mt-5"><SignInButton /></div></div></div>;

  if (user?.requirePasswordChange) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5"><div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-2xl"><h1 className="text-xl font-bold">{tr("Badilisha password yako")}</h1><p className="text-sm text-muted-foreground">{tr("Kwa usalama, lazima ubadilishe password ya kuanzia kabla ya kuendelea.")}</p><ChangePasswordForm /></div></div>;

  if (business?.suspended) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl"><h1 className="text-xl font-bold">{tr("Biashara yako imesimamishwa")}</h1><p className="mt-2 text-sm text-slate-300">{tr("Wasiliana na Super Admin ili iwashwe tena.")}</p><div className="mt-5"><SignInButton /></div></div></div>;
  if (business?.expired) return <div className="min-h-screen flex items-center justify-center bg-slate-950 p-5 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl"><h1 className="text-xl font-bold">{business.subscription?.plan === "demo" ? tr("Muda wa demo umeisha") : tr("Usajili wa biashara yako umeisha")}</h1><p className="mt-2 text-sm text-slate-300">{tr("Wasiliana na SmartHub ili ulipie uendelee kutumia mfumo. Data yako yote iko salama.")}</p><div className="mt-5"><SignInButton /></div></div></div>;
  if (business?.needsPicker) return <BusinessPicker />;

  // A screen whose module is not available to this business/user is never shown, even when its address is typed in by hand.
  // Selling Point staff (waiter / waitress) never open the Dashboard: they start at, and are sent back to, Selling Point.

  const sellingStaff = isSellingStaffRole(user?.role);

  if (
    sellingStaff &&
    (location.pathname === "/dashboard" ||
      location.pathname.startsWith("/dashboard/"))
  ) {
    return <Navigate to="/selling-point" replace />;
  }

  const moduleOfRoute = MODULES.find(
    (m) => m.path === "/" + (location.pathname.split("/")[1] ?? ""),
  );

  // Same rules as the sidebar (src/lib/selling-point-access.ts). Super Admin always opens Selling Point; a permission
  // that has not arrived yet means "loading", never "blocked".
  const access = routeAccess({
    pathname: location.pathname,
    role: user?.role,
    permissions,
    modules: business?.modules,
    moduleKey: moduleOfRoute?.key,
  });
  const blocked = access === "blocked";

  return <div className="app-bg flex h-dvh overflow-hidden">
    {isMobile && sidebarOpen && <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
    <Sidebar open={sidebarOpen} mobile={isMobile} onNavigate={() => { if (isMobile) setSidebarOpen(false); }} onToggle={() => setSidebarOpen((o) => !o)} />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <TopBar onMenuToggle={() => setSidebarOpen((o) => !o)} />
      <SubscriptionBanner />
      <main data-app-scroll className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-4 md:p-6">{blocked ? (sellingStaff && location.pathname.startsWith("/selling-point") ? <div className="rounded-xl border p-6 text-sm text-muted-foreground" role="alert">{tr("Huna ruhusa ya kufikia ukurasa huu.")}</div> : <Navigate to={sellingStaff ? "/selling-point" : "/dashboard"} replace />) : access === "loading" ? <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite"><div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" /></div> : <ErrorBoundary resetKey={location.pathname}><Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite"><div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" /></div>}><Outlet /></Suspense></ErrorBoundary>}</main>
    </div>
    <AnnouncementPopup />
  </div>;
}
