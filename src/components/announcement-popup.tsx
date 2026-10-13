import { useState } from "react";
import { useMutation } from "convex/react";
import { Megaphone } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { useNotifications } from "@/hooks/use-notifications.ts";
import { tr } from "@/lib/i18n.ts";

/** Shows the newest unread message from the Super Admin once, as a popup, then marks it read. */
export default function AnnouncementPopup() {
  const { items } = useNotifications();
  const markRead = useMutation(api.notifications.markRead);
  const [closed, setClosed] = useState<string[]>([]);
  const next = items.find((i) => i.code === "announcement" && !i.read && !closed.includes(i.key));
  if (!next) return null;
  const done = () => { setClosed((c) => [...c, next.key]); void markRead({ keys: [next.key] }); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) done(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" />{String(next.params.title)}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap pt-2 text-left text-sm text-foreground">{String(next.params.body)}</DialogDescription>
        </DialogHeader>
        <DialogFooter><Button onClick={done}>{tr("Sawa, nimeelewa")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
