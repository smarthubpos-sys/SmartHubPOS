import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { localDate } from "@/lib/format.ts";

export function useNotifications() {
  const feed = useQuery(api.notifications.feed, { today: localDate() });
  return { items: feed?.items ?? [], unread: feed?.unread ?? 0, loading: feed === undefined };
}
