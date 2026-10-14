import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { localDate } from "@/lib/format.ts";

export function useNotifications() {
  const feed = useQuery(api.notifications.feed, { today: localDate() });
  return { items: feed?.items ?? [], unread: feed?.unread ?? 0, loading: feed === undefined };
}

/**
 * Marks notifications as read. The list updates on screen at once (optimistic update): the item turns "read",
 * drops below the unread ones and the unread counter goes down, without waiting for the server.
 */
export function useMarkRead() {
  return useMutation(api.notifications.markRead).withOptimisticUpdate((store, args) => {
    const query = api.notifications.feed;
    const queryArgs = { today: localDate() };
    const current = store.getQuery(query, queryArgs);
    if (!current) return;
    const keys = new Set(args.keys);
    const items = current.items.map((i) => (keys.has(i.key) ? { ...i, read: true } : i));
    const ordered = [...items.filter((i) => !i.read), ...items.filter((i) => i.read)];
    store.setQuery(query, queryArgs, { items: ordered, unread: items.filter((i) => !i.read).length });
  });
}

/**
 * When the user opens the screen an alert points to (from the menu, a link or the bell), that alert counts as opened:
 * it turns "read" and the red counter goes down. Each key is sent once, so a failed request cannot loop.
 */
export function useAutoReadOnVisit(pathname: string) {
  const { items } = useNotifications();
  const markRead = useMarkRead();
  const sent = useRef(new Set<string>());
  useEffect(() => {
    const keys = items.filter((i) => !i.read && i.link === pathname && !sent.current.has(i.key)).map((i) => i.key);
    if (!keys.length) return;
    for (const k of keys) sent.current.add(k);
    void markRead({ keys });
  }, [items, pathname, markRead]);
}
