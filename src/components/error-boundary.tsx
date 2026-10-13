import { Component, type ErrorInfo, type ReactNode } from "react";
import { tr } from "@/lib/i18n.ts";

/**
 * Catches errors thrown while rendering (including failed Convex queries, which throw inside useQuery)
 * so one broken panel shows a readable message instead of turning the whole app into a blank page.
 * `inline` = small card for a panel; otherwise a full-area message with a reload button.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; inline?: boolean; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI error:", error, info.componentStack); }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Convex wraps backend errors; keep only the useful first line.
    const detail = String(error.message || error).replace(/^\[CONVEX [^\]]*\]\s*/, "").split("\n").find((l) => l.trim()) ?? "";
    if (this.props.inline) {
      return (
        <div role="alert" className="space-y-2 rounded-xl border border-red-300/40 bg-red-500/10 p-3 text-sm">
          <p className="font-medium">{tr("Paneli hii imeshindwa kufunguka.")}</p>
          {detail && <p className="break-words text-xs opacity-80">{detail}</p>}
          <button type="button" className="cursor-pointer rounded-lg border border-white/30 px-3 py-1 text-xs font-medium hover:bg-white/10" onClick={() => this.setState({ error: null })}>{tr("Jaribu tena")}</button>
        </div>
      );
    }
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md space-y-3 rounded-xl border p-6 text-center">
        <p className="text-lg font-semibold">{tr("Kuna hitilafu imetokea kwenye ukurasa huu.")}</p>
        {detail && <p className="break-words text-sm text-muted-foreground">{detail}</p>}
        <button type="button" className="cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted" onClick={() => window.location.reload()}>{tr("Pakia upya")}</button>
      </div>
    );
  }
}
