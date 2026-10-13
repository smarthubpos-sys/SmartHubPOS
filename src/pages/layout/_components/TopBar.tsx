import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useAuth } from "@/hooks/use-auth.ts";
import { Menu, Bell, User, LogOut, Building2, Repeat, MapPin, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useLocation } from "react-router-dom";
import { tr, errorText } from "@/lib/i18n.ts";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/hooks/use-notifications.ts";
import { notificationText } from "@/lib/notify.ts";

const routeTitles: Record<string, string> = {
  "/dashboard": tr("Dashboard"),
  "/sales": tr("Sales"),
  "/stock": tr("Stock Management"),
  "/purchasing": tr("Purchasing"),
  "/payroll": tr("Payroll"),
  "/accounts": tr("Accounts"),
  "/maintenance": tr("Maintenance"),
  "/bills": tr("Bills"),
  "/hr": tr("HR"),
  "/notifications": tr("Notifications"),
  "/help": tr("Help & Support"),
};

type Props = { onMenuToggle: () => void };

export default function TopBar({ onMenuToggle }: Props) {
  const { user, signout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { items, unread } = useNotifications();
  const markRead = useMutation(api.notifications.markRead);
  const currentUser = useQuery(api.users.getCurrentUser);
  const business = useQuery(api.tenants.current);
  const exitBusiness = useMutation(api.tenants.exitBusiness);
  const switchDepartment = useMutation(api.tenants.switchDepartment);
  const departments = business?.departments ?? [];
  const activeDepartment = departments.find((d) => d._id === business?.activeBranchId);
  const pickDepartment = (branchId?: (typeof departments)[number]["_id"]) => void switchDepartment({ branchId }).catch((e) => toast.error(errorText(e, "Imeshindikana kubadilisha idara.")));

  const segment = "/" + (location.pathname.split("/")[1] ?? "");
  const pageTitle = routeTitles[segment] ?? "SmartHubPOS";

  return (
    <header className="glass z-10 flex h-14 flex-shrink-0 items-center gap-2 border-b border-border/60 px-2 sm:h-16 sm:gap-4 sm:px-4">
      <button
        onClick={onMenuToggle}
        aria-label={tr("Menu")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted cursor-pointer"
      >
        <Menu className="w-5 h-5" />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground sm:text-lg">{pageTitle}</h1>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {business?.tenant && (
          <span className="hidden items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground sm:inline-flex" title={tr("Biashara")}>
            <Building2 className="h-3.5 w-3.5" />{business.tenant.name}
          </span>
        )}
        {departments.length > 0 && (business?.canSwitch ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={`cursor-pointer ${activeDepartment ? "" : "border-amber-500 text-amber-700"}`} title={tr("Idara")}>
                <MapPin className="h-4 w-4 sm:mr-1" /><span className="hidden max-w-[8rem] truncate sm:inline">{activeDepartment?.name ?? tr("Idara zote")}</span><ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem className="cursor-pointer" onClick={() => pickDepartment(undefined)}>{tr("Idara zote (ripoti za pamoja)")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {departments.map((d) => <DropdownMenuItem key={d._id} className="cursor-pointer" onClick={() => pickDepartment(d._id)}>{d.name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : activeDepartment && (
          <span className="hidden items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium sm:inline-flex" title={tr("Idara")}><MapPin className="h-3.5 w-3.5" />{activeDepartment.name}</span>
        ))}
        {business?.isSuperAdmin && (
          <Button variant="outline" size="sm" onClick={() => void exitBusiness({})} className="cursor-pointer" aria-label={tr("Badilisha biashara")} title={tr("Badilisha biashara")}>
            <Repeat className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{tr("Badilisha biashara")}</span>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground" aria-label={tr("Notifications")}>
              <Bell className="w-5 h-5" />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1rem))]">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-sm font-semibold">{tr("Notifications")}</p>
              {unread > 0 && <button className="cursor-pointer text-xs text-primary hover:underline" onClick={() => void markRead({ keys: items.filter((i) => !i.read).map((i) => i.key) })}>{tr("Weka zote zimesomwa")}</button>}
            </div>
            <DropdownMenuSeparator />
            {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{tr("Hakuna taarifa mpya.")}</p>}
            {items.slice(0, 6).map((i) => {
              const text = notificationText(i.code, i.params);
              return (
                <DropdownMenuItem key={i.key} className="cursor-pointer items-start gap-2" onClick={() => { void markRead({ keys: [i.key] }); navigate(i.link); }}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.read ? "bg-muted" : i.level === "danger" ? "bg-rose-500" : i.level === "warning" ? "bg-amber-500" : "bg-indigo-500"}`} />
                  <span className="min-w-0"><span className={`block truncate text-sm ${i.read ? "" : "font-semibold"}`}>{text.title}</span><span className="block truncate text-xs text-muted-foreground">{text.body}</span></span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer justify-center text-sm text-primary" onClick={() => navigate("/notifications")}>{tr("Tazama zote")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <User className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-3 py-2">
              <p className="font-medium text-sm text-foreground">{currentUser?.name ?? user?.name ?? tr("User")}</p>
              <p className="text-xs text-muted-foreground capitalize">{currentUser?.role ?? "user"}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signout()} className="text-destructive cursor-pointer">
              <LogOut className="w-4 h-4 mr-2" />
              
              {tr("Sign Out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
