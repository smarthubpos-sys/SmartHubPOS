
import { NavLink } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { cn } from "@/lib/utils.ts";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Truck,
  Users,
  BookOpen,
  Settings,
  Menu,
  Receipt,
  UserCog,
  Bell,
  LifeBuoy,
  Wallet,
} from "lucide-react";
import { tr } from "@/lib/i18n.ts";
import { isSellingStaffRole, isSuperAdminRole, showSellingPointInMenu } from "@/lib/selling-point-access.ts";
import { useNotifications } from "@/hooks/use-notifications.ts";

const groups = [
  {
    title: tr("Kazi Kuu"),
    items: [
      { label: tr("Dashboard"), icon: LayoutDashboard, path: "/dashboard", module: "dashboard" },
      { label: tr("Sales"), icon: ShoppingCart, path: "/sales", module: "sales" },
      { label: tr("Selling Point"), icon: Receipt, path: "/selling-point", module: "waiterOrders" },
      { label: tr("Cashier"), icon: Wallet, path: "/cashier", module: "cashier" },
      { label: tr("Stock"), icon: Package, path: "/stock", module: "stock" },
      { label: tr("Purchasing"), icon: Truck, path: "/purchasing", module: "purchasing" },
    ],
  },
  {
    title: tr("Fedha"),
    items: [
      { label: tr("Accounts"), icon: BookOpen, path: "/accounts", module: "accounts" },
      { label: tr("Bills"), icon: Receipt, path: "/bills", module: "bills" },
    ],
  },
  {
    title: tr("Watu"),
    items: [
      { label: tr("Payroll"), icon: Users, path: "/payroll", module: "payroll" },
      { label: tr("HR"), icon: UserCog, path: "/hr", module: "hr" },
    ],
  },
  {
    title: tr("Mfumo"),
    items: [
      { label: tr("Notifications"), icon: Bell, path: "/notifications", module: "notifications", badge: true },
      { label: tr("Help & Support"), icon: LifeBuoy, path: "/help", module: "help" },
      { label: tr("Maintenance"), icon: Settings, path: "/maintenance", module: "maintenance" },
    ],
  },
];

type Props = {
  open: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
};

export default function Sidebar({
  open: openProp,
  onToggle,
  mobile = false,
  onNavigate,
}: Props) {
  const open = mobile ? true : openProp;
  const { unread } = useNotifications();

  const tenant = useQuery(api.tenants.current);
  const modules = tenant?.modules ?? null;
  const permissions = useQuery(api.maintenance.myPermissions) ?? [];
  const currentUser = useQuery(api.users.getCurrentUser);

  const superAdmin = isSuperAdminRole(currentUser?.role);
  const sellingStaff = isSellingStaffRole(currentUser?.role);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        if (item.module === "waiterOrders") {
          return showSellingPointInMenu({ role: currentUser?.role, permissions, modules, waiterOrdersEnabled: tenant?.waiterOrdersEnabled });
        }
        if (item.module === "cashier") {
          return !superAdmin && !sellingStaff && permissions.includes("waiterOrders.manage") && tenant?.waiterOrdersEnabled === true && (!modules || modules.includes("waiterOrders"));
        }
        if (sellingStaff && item.module === "dashboard") return false;
        if (superAdmin) return true;
        if (modules && !modules.includes(item.module)) return false;
        return item.module === "sales" ? permissions.includes("sales.view") : true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <aside
      aria-hidden={mobile && !openProp ? true : undefined}
      className={cn(
        "sidebar-bg flex flex-shrink-0 flex-col text-sidebar-foreground shadow-2xl",
        mobile
          ? cn(
              "fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] transition-transform duration-300",
              openProp ? "translate-x-0" : "-translate-x-full",
            )
          : cn(
              "transition-all duration-300",
              open ? "w-60" : "w-[72px]",
            ),
      )}
    >
      <div className="flex min-h-[64px] items-center gap-3 border-b border-sidebar-border px-4 py-4">
        <img
          src="/assets/smarthub-logo.webp.png"
          alt="SmartHubPOS"
          className="h-9 w-9 flex-shrink-0 rounded-xl bg-white/10 p-0.5"
        />
        {open && (
          <div className="overflow-hidden">
            <div className="text-sm font-bold leading-tight text-white">
              SmartHubPOS
            </div>
            <div className="text-[10px] leading-tight text-sidebar-foreground/60">
              {tr("Business Management")}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {visibleGroups.map((g) => (
          <div key={g.title} className="space-y-1">
            {open ? (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">
                {g.title}
              </p>
            ) : (
              <div className="mx-3 border-t border-sidebar-border" />
            )}

            {g.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={item.label}
                onClick={() => onNavigate?.()}
                className={({ isActive }) =>
                  cn(
                    "relative flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                    isActive
                      ? "nav-active text-white"
                      : "text-sidebar-foreground/75 hover:bg-white/10 hover:text-white",
                  )
                }
              >
                <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
                {open && <span className="truncate">{item.label}</span>}

                {"badge" in item && item.badge && unread > 0 && (
                  <span
                    className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white",
                      open ? "ml-auto" : "absolute right-1 top-1",
                    )}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-3 pb-4">
        <button
          type="button"
          aria-label={open ? tr("Collapse navigation") : tr("Expand navigation")}
          title={open ? tr("Collapse navigation") : tr("Expand navigation")}
          onClick={onToggle}
          className="flex w-full cursor-pointer items-center justify-center rounded-xl px-3 py-2 text-sidebar-foreground/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
