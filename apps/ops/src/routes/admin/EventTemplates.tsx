import * as React from "react";
import { Link } from "react-router-dom";
import type { AdminEventTemplatesResponse } from "@flamenode/contracts";
import { formatEventUnix, readAdminEventTemplates } from "../../api/adminEvents.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { DeleteEventTemplateButton } from "./DeleteEventTemplateButton.js";

/** MIG-0728 U02: CURRENT admin template inventory and delete refresh. */
export function EventTemplates({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [result, setResult] = React.useState<OpsResult<AdminEventTemplatesResponse> | null>(null);
  const [revision, refresh] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void readAdminEventTemplates(fetchFn, controller.signal).then(next => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, [fetchFn, revision]);

  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <h1>イベントテンプレート</h1>
      <p>イベントの枠・フォーム・権限などの設定を再利用します。開催日時や枠データはコピーしません。</p>
      <Link to="/admin/events">イベント管理へ</Link>{" / "}
      <Link className="fn-btn fn-btn-primary" to="/admin/events/new">新規イベント</Link>
    </header>
    <section className="fn-card">
      <p>既存イベントからテンプレートを作るには、運営トップの「テンプレート化」から保存してください。</p>
      {result == null && <p role="status">読み込み中...</p>}
      {result && result.status !== "ok" && <p role="alert">テンプレートを取得できませんでした。</p>}
      {result?.status === "ok" && !result.data.guardOk && <p role="alert">テンプレートの利用権限を確認できませんでした。</p>}
      {result?.status === "ok" && result.data.guardOk && (
        result.data.templates.length === 0 ? <p>テンプレートはまだありません。</p>
          : <table className="fn-table"><thead><tr><th>名前</th><th>元イベント</th><th>更新</th><th>操作</th></tr></thead>
              <tbody>{result.data.templates.map(template => <tr key={template.id}>
                <td><strong>{template.name}</strong>{template.description && <div>{template.description}</div>}
                  <small className="fn-muted">ID: {template.id}</small></td>
                <td>{template.source_event_id
                  ? <Link to={"/manage/events/" + encodeURIComponent(template.source_event_id)}>{template.source_event_id}</Link>
                  : "-"}</td>
                <td>{formatEventUnix(template.updated_at)}</td>
                <td>
                  <Link to={"/admin/events/new?template=" + encodeURIComponent(template.id)}>このテンプレートで作成</Link>{" "}
                  <DeleteEventTemplateButton id={template.id} name={template.name}
                    fetchFn={fetchFn} onDeleted={refresh} />
                </td>
              </tr>)}</tbody>
            </table>
      )}
    </section>
  </div>;
}
