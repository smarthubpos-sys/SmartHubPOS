import { ConvexError } from "convex/values";

/**
 * Production hides the text of a plain `Error` thrown by a mutation and the screen only gets "Server Error".
 * A ConvexError keeps its text, so the person sees the real reason (e.g. "Stock haitoshi kwa Bia").
 */
export function surfaceError(e: unknown): ConvexError<string> | unknown {
  if (e instanceof ConvexError) return e;
  if (e instanceof Error) {
    const msg = e.message.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("[CONVEX")) ?? e.message;
    return new ConvexError(msg.replace(/^Uncaught Error:\s*/, "").slice(0, 300));
  }
  return e;
}
