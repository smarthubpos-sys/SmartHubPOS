import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, CheckCheck, Info, Megaphone, PackageX } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Empty, PageHeader, Panel } from "@/components/page-kit.tsx";
import { useNotifications } from "@/hooks/use-notifications.ts";
import { notificationText } from "@/lib/notify.ts";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

export default function NotificationsPage() {
  const { items, unread, loading } = useNotifications();
  const markRead = useMutation(api.notifications.markRead);
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
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
              return (
                <li key={i.key}>
                  <button onClick={() => { void markRead({ keys: [i.key] }); navigate(i.link); }} className="flex w-full cursor-pointer items-start gap-3 rounded-xl p-3 text-left hover:bg-muted/50">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone(i.level)}`}>{icon(i.level, i.code)}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${i.read ? "" : "font-semibold"}`}>{text.title}</span>
                      <span className="block text-xs text-muted-foreground">{text.body}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-muted-foreground">{formatDate(i.at)}{!i.read && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
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
