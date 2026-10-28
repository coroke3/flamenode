import * as React from "react";
import type { OpsApi, Summary, SummaryResult, NavigationResult } from "../api/account.js";

export type OpsSurface = "manage" | "admin";
export const AUTH_UNAVAILABLE = "/entry?error=auth_temporarily_unavailable";
export type GateDecision = "allow" | "check-navigation" | "/entry" | "/dashboard" | typeof AUTH_UNAVAILABLE;

/** CURRENT app/(manage|admin)/layout.tsx decision order, plus D-17-14. */
export function decideOpsAccess(surface: OpsSurface, result: SummaryResult): GateDecision {
  if (result.status === "unavailable") return AUTH_UNAVAILABLE;
  if (result.status === "anonymous") return "/entry";
  const summary: Summary = result.summary;
  if (summary.degraded === true) {
    // An unknown / absent reason is never interpreted as successful authorization.
    if (summary.degradedReason !== "pending_requests_unavailable") return AUTH_UNAVAILABLE;
    if (surface === "admin") return summary.role === "admin" ? "allow" : "/dashboard";
    if (summary.role === "admin") return "allow";
    // Pending-request query failure does not mean manage permission failure.
    // Recheck using MIG-0624's independently authorized navigation endpoint.
    return "check-navigation";
  }
  if (surface === "admin") return summary.role === "admin" ? "allow" : "/dashboard";
  return summary.canAccessAdmin || summary.canAccessManage ? "allow" : "/dashboard";
}
export function decideNavigation(result: NavigationResult): Exclude<GateDecision, "check-navigation"> {
  switch (result) {
    case "allow": return "allow";
    case "anonymous": return "/entry";
    case "deny": return "/dashboard";
    default: return AUTH_UNAVAILABLE;
  }
}

/** Same wording as CURRENT error boundary (app/(auth)/error.tsx). */
export function AuthErrorView({ error, reset }: {
  error?: (Error & { digest?: string }) | null;
  reset: () => void;
}): React.ReactElement {
  const shortTrace = (error?.digest ?? "unknown").slice(0, 12);
  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <span className="fn-eyebrow">error</span>
        <h1 className="fn-display fn-page-title">画面の表示中に問題が発生しました</h1>
      </header>
      <section className="fn-entry-status fn-entry-status--warn" role="alert">
        <div>
          <p className="fn-jp fn-entry-status-lead">
            表示前の取得に失敗したか、保存後の画面描画で失敗した可能性があります。
            再送しても安全な操作もあります。まず再読み込みしてください。
          </p>
          <p className="fn-mono fn-text-muted-sm">trace: {shortTrace}</p>
          <div className="fn-panel-actions" style={{ marginTop: 12 }}>
            <button type="button" className="fn-btn fn-btn-primary" onClick={reset}>再読み込み</button>
            <a href="/entry" className="fn-btn">ログイン画面</a>
            <a href="/onboarding" className="fn-btn">オンボーディング</a>
          </div>
        </div>
      </section>
    </div>
  );
}

export function OpsGate({ surface, api, children }: {
  surface: OpsSurface; api: OpsApi; children: React.ReactNode;
}): React.ReactElement {
  // Bind the grant to both route surface and API instance. React may reuse this
  // component when switching /manage -> /admin before the new effect runs.
  const [grant, setGrant] = React.useState<{ surface: OpsSurface; api: OpsApi } | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    setGrant(null);
    async function resolve(): Promise<void> {
      let decision = decideOpsAccess(surface, await api.getSummary(controller.signal));
      if (controller.signal.aborted) return;
      if (decision === "check-navigation") {
        decision = decideNavigation(await api.checkManageNavigation(controller.signal));
      }
      if (controller.signal.aborted) return;
      if (decision === "allow") setGrant({ surface, api });
      else window.location.assign(decision);
    }
    void resolve().catch(() => {
      if (!controller.signal.aborted) window.location.assign(AUTH_UNAVAILABLE);
    });
    return () => controller.abort();
  }, [api, surface]);
  if (grant?.surface !== surface || grant.api !== api) {
    return <div role="status" aria-busy="true" className="fn-public-container fn-page">読み込み中...</div>;
  }
  return <>{children}</>;
}
