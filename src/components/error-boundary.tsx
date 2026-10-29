import { Component, type ErrorInfo, type ReactNode } from "react";
import { errorKind, errorText, tr } from "@/lib/i18n.ts";

/**
 * Handles render and query errors.
 * Permission denials are shown separately from genuine server errors.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; inline?: boolean; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const rawMessage = String(error.message || error);
    // Not signed in / session ended, or signed in but this account is not allowed: these are NOT system faults.
    // The text comes from the server (ConvexError) and is shown in the system language, with what the person should do.
    const kind = errorKind(error);
    // The screen calls a Convex function that the deployment does not have yet (frontend newer than `npx convex deploy`).
    const backendOutdated = /Could not find public function/i.test(rawMessage);
    // Only a message written for people (a ConvexError, or an outdated-server notice) is shown; technical JavaScript errors stay in the console.
    const readable = typeof (error as { data?: unknown }).data === "string" || backendOutdated;
    const detail = readable ? errorText(error) : "";

    if (kind === "signin") {
      return (
        <div role="alert" className="mx-auto mt-16 max-w-md space-y-4 rounded-xl border p-6 text-center">
          <h2 className="text-lg font-semibold">{tr("Muda wako wa kuingia umeisha.")}</h2>
          <p className="text-sm text-muted-foreground">{errorText(error)}</p>
          <button
            type="button"
            className="cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            onClick={() => window.location.reload()}
          >
            {tr("Ingia tena")}
          </button>
        </div>
      );
    }

    if (kind === "permission") {
      return (
        <div
          role="alert"
          className="mx-auto mt-16 max-w-md space-y-4 rounded-xl border p-6 text-center"
        >
          <h2 className="text-lg font-semibold">
            {tr("Huna ruhusa ya kufikia ukurasa huu.")}
          </h2>
          <p className="text-sm font-medium">{errorText(error)}</p>
          <p className="text-sm text-muted-foreground">
            {tr(
              "Huwezi kufungua sehemu hii kwa kutumia akaunti yako ya sasa. Ikiwa unahitaji ruhusa hii kwa kazi zako, wasiliana na msimamizi wa mfumo."
            )}
          </p>
          <button
            type="button"
            className="cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            onClick={() => window.location.assign("/dashboard")}
          >
            {tr("Rudi Dashboard")}
          </button>
        </div>
      );
    }

    if (this.props.inline) {
      return (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-red-300/40 bg-red-500/10 p-3 text-sm"
        >
          <p className="font-medium">
            {tr("Paneli hii imeshindwa kufunguka.")}
          </p>
          {backendOutdated && (
            <p className="text-xs">
              {tr("Server (Convex) bado haina toleo jipya la mfumo. Msimamizi wa mfumo anapaswa kutuma (deploy) functions mpya za Convex.")}
            </p>
          )}
          <p className="break-words text-xs opacity-80">
            {detail || tr("Jaribu tena. Tatizo likiendelea, wasiliana na msimamizi wa mfumo.")}
          </p>
          <button
            type="button"
            className="cursor-pointer rounded-lg border border-white/30 px-3 py-1 text-xs font-medium hover:bg-white/10"
            onClick={() => this.setState({ error: null })}
          >
            {tr("Jaribu tena")}
          </button>
        </div>
      );
    }

    return (
      <div
        role="alert"
        className="mx-auto mt-16 max-w-md space-y-3 rounded-xl border p-6 text-center"
      >
        <p className="text-lg font-semibold">
          {tr("Kuna hitilafu imetokea kwenye ukurasa huu.")}
        </p>
        {backendOutdated && (
          <p className="text-sm text-muted-foreground">
            {tr("Server (Convex) bado haina toleo jipya la mfumo. Msimamizi wa mfumo anapaswa kutuma (deploy) functions mpya za Convex.")}
          </p>
        )}
        <p className="break-words text-sm text-muted-foreground">
          {detail || tr("Jaribu tena. Tatizo likiendelea, wasiliana na msimamizi wa mfumo.")}
        </p>
        <button
          type="button"
          className="cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          onClick={() => window.location.reload()}
        >
          {tr("Pakia upya")}
        </button>
      </div>
    );
  }
}