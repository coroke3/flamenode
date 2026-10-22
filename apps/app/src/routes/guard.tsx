import * as React from "react";
import type { PersonalApi, PersonalSessionUser, SessionState } from "../api/session.js";
import { entryLoginHref } from "./next.js";

/** Same markup/text as CURRENT RequireAuthRedirect (src/lib/auth/guard.tsx). */
export function LoginRequired({ next }: { next: string }): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-guard-shell">
      <div className="fn-empty fn-guard-card">
        <h1 className="fn-guard-title">ログインが必要です</h1>
        <p className="fn-empty-message">この画面はログイン後にご利用いただけます。</p>
        <a href={entryLoginHref(next)} className="fn-btn fn-btn-primary fn-mt-md">
          Discord でログイン
        </a>
      </div>
    </div>
  );
}

/** Same markup/text as CURRENT BannedNotice. */
export function BannedNotice(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-guard-shell">
      <div className="fn-empty fn-guard-card fn-guard-card--danger">
        <h1 className="fn-guard-title fn-guard-title--danger">利用が停止されています</h1>
        <p className="fn-empty-message">
          現在、このアカウントは利用が停止されています。
          詳細は運営までお問い合わせください。
        </p>
      </div>
    </div>
  );
}

/** UX-AUTH-005: a failed session read must not look like logout or a role change. */
export function AuthUnavailable(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-guard-shell">
      <div className="fn-empty fn-guard-card" role="status">
        <h1 className="fn-guard-title">認証状態を確認できません</h1>
        <p className="fn-empty-message">
          一時的に認証状態を確認できません。時間をおいて再読み込みしてください。
        </p>
      </div>
    </div>
  );
}

export function SessionLoading(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-guard-shell" role="status" aria-busy="true">
      <p className="fn-empty-message">読み込み中...</p>
    </div>
  );
}

/** Pure gate (testable): decides which guard view, if any, replaces the page. */
export function GateView({
  state,
  next,
  children,
}: {
  state: SessionState;
  next: string;
  children: (user: PersonalSessionUser) => React.ReactNode;
}): React.ReactElement {
  if (state.status === "loading") return <SessionLoading />;
  if (state.status === "unavailable") return <AuthUnavailable />;
  if (state.status === "anonymous") return <LoginRequired next={next} />;
  if (state.user.is_banned === 1) return <BannedNotice />;
  return <>{children(state.user)}</>;
}

export function useSession(api: PersonalApi): SessionState {
  const [state, setState] = React.useState<SessionState>({ status: "loading" });
  React.useEffect(() => {
    const ctrl = new AbortController();
    api.getSession(ctrl.signal).then(
      (r) => {
        if (!ctrl.signal.aborted) setState(r);
      },
      () => {
        if (!ctrl.signal.aborted) setState({ status: "unavailable" });
      },
    );
    return () => ctrl.abort();
  }, [api]);
  return state;
}

export function SessionGate({
  api,
  next,
  children,
}: {
  api: PersonalApi;
  next: string;
  children: (user: PersonalSessionUser) => React.ReactNode;
}): React.ReactElement {
  return <GateView state={useSession(api)} next={next} children={children} />;
}
