import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const markReadFn = vi.fn();
let feed: { items: Array<{ key: string; link: string; read: boolean }>; unread: number } = { items: [], unread: 0 };
vi.mock("convex/react", () => ({
  useQuery: () => feed,
  useMutation: () => Object.assign(markReadFn, { withOptimisticUpdate: () => markReadFn }),
}));

import { useAutoReadOnVisit } from "./use-notifications.ts";

describe("useAutoReadOnVisit", () => {
  beforeEach(() => { markReadFn.mockClear(); });

  it("marks an alert as read once its screen is opened", () => {
    feed = { items: [{ key: "low:1", link: "/stock/reports/reorder", read: false }, { key: "other", link: "/hr", read: false }], unread: 2 };
    const { rerender } = renderHook(({ path }) => useAutoReadOnVisit(path), { initialProps: { path: "/stock/reports/reorder" } });
    expect(markReadFn).toHaveBeenCalledTimes(1);
    expect(markReadFn).toHaveBeenCalledWith({ keys: ["low:1"] });
    rerender({ path: "/stock/reports/reorder" });
    expect(markReadFn).toHaveBeenCalledTimes(1); // not sent twice
  });

  it("does nothing for already-read alerts or other screens", () => {
    feed = { items: [{ key: "low:1", link: "/stock", read: true }, { key: "x", link: "/hr", read: false }], unread: 1 };
    renderHook(() => useAutoReadOnVisit("/stock"));
    expect(markReadFn).not.toHaveBeenCalled();
  });
});
