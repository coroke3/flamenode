import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import type { AdminEventTemplatesResponse } from "@flamenode/contracts";
import { formatEventUnix, readAdminEventTemplates } from "../../api/adminEvents.js";
import { adminReadRedirect } from "../../api/adminTop.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { AdminSectionTabs } from "../../components/shared/AdminSectionTabs.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { Icon } from "../../components/shared/Icon.js";
import { DeleteEventTemplateButton } from "./DeleteEventTemplateButton.js";

/** MIG-0728 U02/U03: CURRENT admin template inventory and delete refresh. */
export function EventTemplates({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { search } = useLocation();
  const urlParams = new URLSearchParams(search);
  const notice = (urlParams.get("notice") ?? "").slice(0, 200);
  const error = (urlParams.get("error") ?? "").slice(0, 200);
  const [result, setResult] = React.useState<OpsResult<AdminEventTemplatesResponse> | null>(null);
  const [revision, refresh] = React.useReducer((value) => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void readAdminEventTemplates(fetchFn, controller.signal).then((next) => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, [fetchFn, revision]);

  const redirect = result ? adminReadRedirect(result) : null;
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  if (result && (result.status === "anonymous" || result.status === "forbidden")) {
    return <p role="status">読み込み中…</p>;
  }

  return (
    <section className="fn-page" aria-label="イベントテンプレート">
      <ConsolePageHeader
        title="イベントテンプレート"
        description="イベントの枠・フォーム・権限などの設定を再利用します。開催日時や枠データはコピーしません。"
        backHref="/admin/events"
        backLabel="イベント管理へ"
        actions={[
          {
            href: "/admin/events/new",
            label: "新規イベント",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

      <AdminSectionTabs hub="events" />

      {notice ? (
        <p className="fn-alert fn-alert-success" role="status" style={{ marginBottom: 12 }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="fn-alert fn-alert-danger" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}

      <section className="fn-card" style={{ marginTop: 18, padding: "18px 22px" }}>
        <p className="fn-muted fn-text-sm" style={{ margin: "0 0 14px" }}>
          既存イベントからテンプレートを作るには、イベント運営トップ（/manage/events/[id]）の「テンプレート化」から保存してください。
        </p>
        {result == null ? <p role="status">読み込み中...</p> : null}
        {result && result.status !== "ok" ? (
          <p role="alert">テンプレートを取得できませんでした。</p>
        ) : null}
        {result?.status === "ok" && !result.data.guardOk ? (
          <p role="alert">テンプレートの利用権限を確認できませんでした。</p>
        ) : null}
        {result?.status === "ok" && result.data.guardOk ? (
          result.data.templates.length === 0 ? (
            <p className="fn-muted fn-text-sm">テンプレートはまだありません。</p>
          ) : (
            <FnTable>
              <thead>
                <tr>
                  <th scope="col">名前</th>
                  <th scope="col">元イベント</th>
                  <th scope="col">更新</th>
                  <th scope="col" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {result.data.templates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <strong>{template.name}</strong>
                      {template.description ? (
                        <div className="fn-muted fn-text-sm">{template.description}</div>
                      ) : null}
                      <div className="fn-muted fn-text-sm">ID: {template.id}</div>
                    </td>
                    <td>
                      {template.source_event_id ? (
                        <Link
                          to={"/manage/events/" + encodeURIComponent(template.source_event_id)}
                        >
                          {template.source_event_id}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="fn-muted fn-text-sm">
                      {formatEventUnix(template.updated_at)}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link
                        to={"/admin/events/new?template=" + encodeURIComponent(template.id)}
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                        style={{ marginRight: 6 }}
                      >
                        このテンプレートで作成
                      </Link>
                      <DeleteEventTemplateButton
                        id={template.id}
                        name={template.name}
                        fetchFn={fetchFn}
                        onDeleted={refresh}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </FnTable>
          )
        ) : null}
      </section>
    </section>
  );
}
