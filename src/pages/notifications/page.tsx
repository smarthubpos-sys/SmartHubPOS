import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, CheckCheck, ChevronDown, ExternalLink, Info, Megaphone, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Empty, PageHeader, Panel } from "@/components/page-kit.tsx";
import { useMarkRead, useNotifications } from "@/hooks/use-notifications.ts";
import { notificationText } from "@/lib/notify.ts";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

export default function NotificationsPage() {
  const { items, unread, loading } = useNotifications();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Messages from SmartHub have no other screen to open, so they expand here (the bell passes the key to open).
  const [open, setOpen] = useState<string | null>((location.state as { open?: string } | null)?.open ?? null);
  const shown = unreadOnly ? items.filter((i) => !i.read) : items;
  const icon = (level: string, code: string) => code === "announcement" ? <Megaphone className="h-4 w-4" /> : code === "out_of_stock" ? <PackageX className="h-4 w-4" /> : level === "info" ? <Info className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />;
  const tone = (level: string) => level === "danger" ? "bg-rose-500/15 text-rose-600" : level === "warning" ? "bg-amber-500/20 text-amber-600" : "bg-indigo-500/15 text-indigo-600";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader icon={Bell} title={tr("Notifications")} subtitle={tr("Taarifa za stoo, bili, likizo, mishahara, usajili na ujumbe kutoka SmartHub.")}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => setUnreadOnly((v) => !v)}>{unreadOnly ? tr("Onyesha zote") : tr("Ambazo hazijasomwa ({0})", [unread])}</Button>
          <Button size="sm" disabled={unread === 0} onClick={() => void markRead({ keys: items.filter((i) => !i.read).map((i) => i.key) })}><CheckCheck className="mr-1 h-4 w-4" />{tr("Weka zote zimesomwa")}</Button>
        </>} />
      <Panel>
        {loading ? null : shown.length === 0 ? <Empty>{tr("Hakuna taarifa mpya.")}</Empty> : (
          <ul className="divide-y divide-border/60">
            {shown.map((i) => {
              const text = notificationText(i.code, i.params);
              const inPlace = i.link === "/notifications";
              const expanded = inPlace && open === i.key;
              return (
                <li key={i.key}>
                  <button type="button" aria-expanded={inPlace ? expanded : undefined}
                    onClick={() => { void markRead({ keys: [i.key] }); if (inPlace) setOpen(expanded ? null : i.key); else navigate(i.link); }}
                    className={`flex w-full cursor-pointer items-start gap-3 rounded-xl p-3 text-left hover:bg-muted/50 ${i.read && !expanded ? "opacity-60" : ""}`}>
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${i.read ? "bg-muted text-muted-foreground" : tone(i.level)}`}>{icon(i.level, i.code)}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${i.read ? "" : "font-semibold"}`}>{text.title}</span>
                      <span className={`block whitespace-pre-wrap break-words text-xs text-muted-foreground ${inPlace && !expanded ? "line-clamp-2" : ""}`}>{text.body}</span>
                      {inPlace && <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary">{expanded ? tr("Funga") : tr("Soma ujumbe wote")}</span>}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">
                      {formatDate(i.at)}
                      {!i.read && <span className="h-2 w-2 rounded-full bg-primary" />}
                      {inPlace ? <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} /> : <ExternalLink className="h-3.5 w-3.5 opacity-60" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
