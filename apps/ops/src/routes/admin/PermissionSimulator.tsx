// MIG-0726 U03: port of CURRENT permissions/simulator/page.tsx + PermissionSimulatorPanel.tsx (SA-xxx).
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import {
  adminReadRedirect, fetchPermissionSimulator, normalizeSimulatorQuery,
  type AdminPermissionSimulatorResponse,
} from "../../api/adminTop.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { useApiResult } from "../useApiResult.js";

type Result = AdminPermissionSimulatorResponse["result"];

/** Pure panel (CURRENT PermissionSimulatorPanel). The GET form keeps full-page navigation semantics. */
export function PermissionSimulatorPanel({ eventId, xUserId, result }: {
  eventId: string; xUserId: string; result: Result;
}): React.ReactElement {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form method="get" className="fn-form-grid" style={{ maxWidth: 640 }}>
        <label className="fn-label">
          イベント ID
          <input name="event_id" className="fn-input" defaultValue={eventId} placeholder="evt_..." required />
        </label>
        <label className="fn-label">
          X ID
          <input name="x_user_id" className="fn-input" defaultValue={xUserId} placeholder="@screen_name" required />
        </label>
        <button type="submit" className="fn-btn fn-btn-primary">権限をシミュレート</button>
      </form>

      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        X IDを入力してください。イベントスタッフ登録の正本を参照します。
      </p>

      {!result ? (
        <p className="fn-muted">条件を入力してシミュレートしてください。</p>
      ) : !result.found ? (
        <p role="status" className="fn-muted">
          該当するスタッフ行が見つかりませんでした（event: <code>{result.eventId}</code>）。
        </p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="fn-card">
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>スタッフ情報</h2>
            <dl className="admin-permission-result-grid" style={{ display: "grid", gridTemplateColumns: "minmax(120px, auto) 1fr", gap: "6px 12px", fontSize: 13 }}>
              <dt className="fn-muted">表示名</dt>
              <dd style={{ margin: 0 }}>{result.displayName ?? "—"}</dd>
              <dt className="fn-muted">プリセット</dt>
              <dd style={{ margin: 0 }}>
                <span className="fn-badge fn-badge-soft">{result.presetLabel}</span>{" "}
                <code>{result.preset}</code>
              </dd>
              <dt className="fn-muted">X ID</dt>
              <dd style={{ margin: 0 }}>{result.xUserId ? `@${result.xUserId}` : "—"}</dd>
            </dl>
            <p style={{ marginTop: 12 }}>
              <Link href={`/manage/events/${encodeURIComponent(result.eventId)}/staff`} className="fn-btn fn-btn-ghost fn-btn-sm">
                スタッフ管理へ
              </Link>
            </p>
          </section>

          <section className="fn-card">
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>主要権限</h2>
            <table className="fn-table">
              <thead>
                <tr><th>権限</th><th>可否</th></tr>
              </thead>
              <tbody>
                {result.spotlight.map((item) => (
                  <tr key={item.key}>
                    <td>{item.label}</td>
                    <td>
                      {item.allowed
                        ? <span className="fn-badge fn-badge-accent">可</span>
                        : <span className="fn-badge fn-badge-soft">不可</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="fn-card">
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              解決済み権限一覧（{result.resolvedKeys.length}）
            </h2>
            {result.resolvedKeys.length === 0 ? (
              <p className="fn-muted fn-text-sm">権限キーはありません。</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {result.resolvedLabels.map((label) => <li key={label}>{label}</li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Page shell shared by the loaded and empty states (CURRENT page.tsx). */
export function PermissionSimulatorPage({ eventId, xUserId, result }: {
  eventId: string; xUserId: string; result: Result;
}): React.ReactElement {
  return (
    <div>
      <ConsolePageHeader
        title="権限シミュレーター"
        description="イベントスタッフのプリセットとカスタム権限をX IDから確認します。"
      />
      <PermissionSimulatorPanel eventId={eventId} xUserId={xUserId} result={result} />
    </div>
  );
}

const defaultFetch = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);

export function PermissionSimulator({ fetchFn = defaultFetch }: {
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
}): React.ReactElement {
  const [params] = useSearchParams();
  const query = normalizeSimulatorQuery(params);
  const state = useApiResult(
    (signal) => fetchPermissionSimulator(fetchFn, query, signal),
    "simulator:" + query.eventId + "\u0000" + query.xUserId,
  );
  const redirect = state.status === "loading" ? null : adminReadRedirect(state);
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);
  if (state.status === "loading" || state.status === "anonymous" || state.status === "forbidden") {
    return <div role="status" aria-busy="true">読み込み中...</div>;
  }
  if (state.status !== "ok") {
    return (
      <div role="alert" className="fn-public-container fn-page">
        権限シミュレーターを読み込めませんでした。再読み込みしてください。
      </div>
    );
  }
  return <PermissionSimulatorPage eventId={query.eventId} xUserId={query.xUserId} result={state.data.result} />;
}
