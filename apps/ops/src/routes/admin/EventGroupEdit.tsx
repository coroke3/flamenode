/**
 * MIG-0728 U01: CURRENT /admin/event-groups/new and /admin/event-groups/:id/edit.
 */
import * as React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createAdminEventGroupsApi,
  eventGroupPublicHref,
} from "../../api/adminEventGroups.js";
import { adminReadRedirect } from "../../api/adminTop.js";
import type { OpsFetch } from "../../api/read.js";
import { AdminSectionTabs } from "../../components/shared/AdminSectionTabs.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { ConsolePanel } from "../../components/shared/ConsolePanel.js";
import { Icon } from "../../components/shared/Icon.js";
import { SaveSuccessNotice } from "../../components/shared/SaveSuccessNotice.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";
import { DeleteEventGroupForm } from "./DeleteEventGroupForm.js";
import { EventGroupForm, type EventGroupInitial } from "./EventGroupForm.js";
import { EventGroupMembersEditor } from "./EventGroupMembersEditor.js";

function asGroupType(value: string): EventGroupInitial["group_type"] {
  switch (value) {
    case "series":
    case "genre":
    case "related":
    case "collection":
    case "other":
      return value;
    default:
      return "other";
  }
}

function asVisibilityStatus(value: string): EventGroupInitial["visibility_status"] {
  switch (value) {
    case "public":
    case "private":
    case "archived":
      return value;
    default:
      return "private";
  }
}

export function EventGroupCreatePage({
  fetchFn,
}: { fetchFn?: OpsFetch } = {}): React.ReactElement {
  const api = React.useMemo(() => createAdminEventGroupsApi(fetchFn), [fetchFn]);
  const navigate = useNavigate();
  return (
    <section className="fn-page" aria-label="新規イベントグループ">
      <ConsolePageHeader
        title="新規イベントグループ"
        backHref="/admin/event-groups"
        backLabel="グループ一覧へ"
      />

      <AdminSectionTabs hub="events" />

      <ConsolePanel>
        <EventGroupForm
          mode="create"
          api={api}
          onSaved={({ id, pendingPublicReflection }) => {
            if (!id) return;
            const target = `/admin/event-groups/${encodeURIComponent(id)}/edit`;
            if (pendingPublicReflection) {
              const qs = new URLSearchParams({
                notice: "作成しました。公開側への反映待ちです。",
              });
              navigate(`${target}?${qs.toString()}`);
            } else {
              navigate(target);
            }
          }}
        />
      </ConsolePanel>
    </section>
  );
}

/** A 404/401/403 never mounts a previously loaded edit form or delete control. */
export function EventGroupEditPage({
  fetchFn,
}: { fetchFn?: OpsFetch } = {}): React.ReactElement {
  const { id = "" } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const api = React.useMemo(() => createAdminEventGroupsApi(fetchFn), [fetchFn]);
  const [refreshKey, refresh] = React.useReducer((n) => n + 1, 0);
  const [saveNotice, setSaveNotice] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);
  const urlParams = new URLSearchParams(search);
  const urlNotice = (urlParams.get("notice") ?? "").slice(0, 200);
  const urlError = (urlParams.get("error") ?? "").slice(0, 200);

  const result = useApiResult(
    (signal) => api.readDetail(id, signal),
    "admin-event-group-edit:" + id,
    refreshKey,
  );
  const redirect = result.status === "loading" ? null : adminReadRedirect(result);
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden") {
    return <p role="status">読み込み中…</p>;
  }
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") {
    return <p role="alert">イベントグループを取得できませんでした。再読み込みしてください。</p>;
  }

  const { group, members, eventOptions, nextCursor } = result.data;
  return (
    <section className="fn-page" aria-label="イベントグループ編集画面">
      <ConsolePageHeader
        title={`${group.name} を編集`}
        backHref="/admin/event-groups"
        backLabel="グループ一覧へ"
        actions={[
          ...(group.visibility_status === "public"
            ? [
                {
                  href: eventGroupPublicHref(group.slug),
                  label: "公開ページ",
                  icon: <Icon name="external" size={12} aria-hidden />,
                },
              ]
            : []),
          {
            href: `/admin/audit?table=event_groups&record=${encodeURIComponent(group.id)}`,
            label: "監査ログ",
            icon: <Icon name="clock" size={12} aria-hidden />,
          },
        ]}
      />

      <AdminSectionTabs hub="events" />

      {saveNotice ? (
        <SaveSuccessNotice
          message={saveNotice.message}
          pendingPublicReflection={saveNotice.pendingPublicReflection}
          className="fn-alert fn-alert-success"
          style={{ marginBottom: 12 }}
        />
      ) : urlNotice ? (
        <p className="fn-alert fn-alert-success" role="status" style={{ marginBottom: 12 }}>
          {urlNotice}
        </p>
      ) : null}
      {urlError ? (
        <p className="fn-alert fn-alert-danger" role="alert" style={{ marginBottom: 12 }}>
          {urlError}
        </p>
      ) : null}

      <ConsolePanel title="基本情報">
        <EventGroupForm
          key={`${group.id}:${group.updated_at}`}
          mode="edit"
          api={api}
          initial={{
            id: group.id,
            base_updated_at: group.updated_at,
            name: group.name,
            slug: group.slug,
            description: group.description,
            group_type: asGroupType(group.group_type),
            icon_url: group.icon_url,
            accent_color: group.accent_color,
            visibility_status: asVisibilityStatus(group.visibility_status),
            sort_order: group.sort_order ?? 0,
          }}
          onSaved={({ pendingPublicReflection }) => {
            setSaveNotice({ message: "保存しました。", pendingPublicReflection });
            refresh();
          }}
        />
      </ConsolePanel>

      <ConsolePanel title="所属イベント" separated>
        <EventGroupMembersEditor
          key={group.id}
          groupId={group.id}
          members={members}
          eventOptions={eventOptions}
          initialEventOptionsCursor={nextCursor}
          api={api}
          onChanged={() => refresh()}
        />
      </ConsolePanel>

      <ConsolePanel title="削除" tone="danger" separated compact>
        <DeleteEventGroupForm
          key={group.id}
          id={group.id}
          name={group.name}
          api={api}
          onDeleted={() => {
            const qs = new URLSearchParams({ notice: "グループを削除しました。" });
            navigate(`/admin/event-groups?${qs.toString()}`);
          }}
        />
      </ConsolePanel>
    </section>
  );
}
