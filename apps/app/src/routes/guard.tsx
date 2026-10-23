import * as React from "react";
import type { PersonalUser } from "@flamenode/contracts";
import type { ApiResult, PersonalApi, SessionState } from "../api/personal.js";
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

/** Same text/markup/actions as CURRENT app/(auth)/error.tsx. */
export function AuthErrorView({
  error,
  reset,
}: {
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
            <button type="button" className="fn-btn fn-btn-primary" onClick={reset}>
              再読み込み
            </button>
            <a href="/entry" className="fn-btn">
              ログイン画面
            </a>
            <a href="/onboarding" className="fn-btn">
              オンボーディング
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * UX-AUTH-005: a failed session read must not look like logout or a role change.
 * CURRENT surfaces auth failures through the same (auth)/error.tsx screen.
 */
export function AuthUnavailable(): React.ReactElement {
  return <AuthErrorView reset={() => window.location.reload()} />;
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
  children: (user: PersonalUser) => React.ReactNode;
}): React.ReactElement {
  if (state.status === "loading") return <SessionLoading />;
  if (state.status === "unavailable") return <AuthUnavailable />;
  if (state.status === "anonymous") return <LoginRequired next={next} />;
  if (state.status === "banned" || state.user.is_banned === 1) return <BannedNotice />;
  return <>{children(state.user)}</>;
}

export type DataState<T> = { status: "loading" } | ApiResult<T>;
const LOADING = { status: "loading" } as const;

/**
 * Loads one Personal read endpoint. `key` identifies the request (path + query); a new key aborts the
 * previous request and goes back to "loading". The session is not read separately: every
 * /api/personal/* endpoint answers 401/403 itself (one request per screen, not two).
 */
export function useApiResult<T>(
  api: PersonalApi,
  key: string,
  load: (api: PersonalApi, signal: AbortSignal) => Promise<ApiResult<T>>,
): DataState<T> {
  const [state, setState] = React.useState<DataState<T>>(LOADING);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  React.useEffect(() => {
    const ctrl = new AbortController();
    setState(LOADING);
    loadRef.current(api, ctrl.signal).then(
      (r) => {
        if (!ctrl.signal.aborted) setState(r);
      },
      () => {
        if (!ctrl.signal.aborted) setState({ status: "unavailable" });
      },
    );
    return () => ctrl.abort();
  }, [api, key]);
  return state;
}

/** Same gate order as GateView, for a data endpoint. `unavailable` lets a screen keep CURRENT's own degraded view. */
export function ResultView<T>({
  state,
  next,
  unavailable,
  children,
}: {
  state: DataState<T>;
  next: string;
  unavailable?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}): React.ReactElement {
  if (state.status === "loading") return <SessionLoading />;
  if (state.status === "unavailable") return <>{unavailable ?? <AuthUnavailable />}</>;
  if (state.status === "anonymous") return <LoginRequired next={next} />;
  if (state.status === "banned") return <BannedNotice />;
  return <>{children(state.data)}</>;
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
  children: (user: PersonalUser) => React.ReactNode;
}): React.ReactElement {
  return <GateView state={useSession(api)} next={next} children={children} />;
}
