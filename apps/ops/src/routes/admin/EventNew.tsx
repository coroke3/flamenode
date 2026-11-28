// Port of CURRENT app/(admin)/admin/events/new/page.tsx (MIG-0721); protected route integration remains gated.
import * as React from "react";
import { useLocation } from "react-router-dom";
import { readAdminEventNew } from "../../api/adminEvents.js";
import { adminReadRedirect } from "../../api/adminTop.js";
import type { OpsFetch } from "../../api/read.js";
import { EventForm, type EventFormProps } from "../../components/event/EventForm.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { ConsolePanel } from "../../components/shared/ConsolePanel.js";
import { Icon } from "../../components/shared/Icon.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";

type EventNewProps = Pick<EventFormProps, "createEvent" | "updateEvent" | "router"> & {
  fetchFn?: OpsFetch;
  refreshKey?: number;
};

/** Required write/navigation ports are supplied by the future protected host. */
export function EventNew(props: EventNewProps): React.ReactElement {
  const { fetchFn } = props;
  const [provider, setProvider] = React.useState({ fetchFn, revision: 0 });
  React.useEffect(() => {
    setProvider(previous => previous.fetchFn === fetchFn ? previous : {
      fetchFn, revision: previous.revision + 1,
    });
  }, [fetchFn]);

  // Changing a provider must retire the old read and form before any new response.
  // The shared read hook keys requests by query, not by loader identity.
  if (provider.fetchFn !== fetchFn) return <p role="status" aria-busy="true">読み込み中…</p>;
  return <EventNewRead key={provider.revision} {...props} />;
}

function EventNewRead({
  fetchFn, refreshKey = 0, createEvent, updateEvent, router,
}: EventNewProps): React.ReactElement {
  const { search } = useLocation();
  const templates = new URLSearchParams(search).getAll("template");
  // CURRENT rejects repeated search parameters (Next supplies an array).
  const templateId = templates.length === 1 ? templates[0]!.trim() : "";
  const result = useApiResult(
    signal => readAdminEventNew(templateId || null, fetchFn, signal),
    "admin-event-new:" + templateId,
    refreshKey,
  );
  const redirect = result.status === "loading" ? null : adminReadRedirect(result);
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden") {
    return <p role="status" aria-busy="true">読み込み中…</p>;
  }
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") {
    return <p role="alert">イベント作成情報を取得できませんでした。再読み込みしてください。</p>;
  }
  const data = result.data;

  return (
    <div>
      <ConsolePageHeader
        title="新規イベント作成"
        description={data.templateName
          ? `テンプレート「${data.templateName}」の設定を読み込みました。開催日時は空欄のまま入力してください。`
          : "イベント本体を作成します。枠とイベント管理者は作成後に追加します。"}
        backHref="/admin/events"
        backLabel="イベント一覧へ"
        actions={[{
          href: "/admin/events/templates", label: "テンプレート一覧",
          icon: <Icon name="list" size={12} aria-hidden />,
        }]}
      />

      {data.guardOk && data.templates.length > 0 ? (
        <section className="fn-card" style={{ marginTop: 16, padding: "14px 18px" }}>
          <p className="fn-label" style={{ margin: "0 0 8px" }}>テンプレートから作成</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.templates.map(template => (
              <Link
                key={template.id}
                href={`/admin/events/new?template=${encodeURIComponent(template.id)}`}
                className={template.id === data.templateId
                  ? "fn-btn fn-btn-primary fn-btn-sm" : "fn-btn fn-btn-ghost fn-btn-sm"}
              >
                {template.name}
              </Link>
            ))}
            {data.templateId ? (
              <Link href="/admin/events/new" className="fn-btn fn-btn-ghost fn-btn-sm">
                テンプレートなし
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <ConsolePanel>
        <EventForm
          mode="create"
          {...data.formProps}
          createEvent={createEvent}
          updateEvent={updateEvent}
          router={router}
        />
      </ConsolePanel>

      <p style={{ marginTop: 22 }}>
        <Link href="/admin/events" className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> イベント管理に戻る
        </Link>
      </p>
    </div>
  );
}
