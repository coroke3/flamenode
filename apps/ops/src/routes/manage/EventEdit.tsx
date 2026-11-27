// Port of CURRENT app/(manage)/manage/events/[id]/edit/page.tsx (MIG-0721 U02c).
// Staged consumer only. The protected host and canonical mutation ports are not mounted.
import * as React from "react";
import { useParams } from "react-router-dom";
import { readManageEventEdit } from "../../api/eventLifecycle.js";
import type { OpsFetch } from "../../api/read.js";
import { EventForm, type EventFormInitial, type EventFormProps } from "../../components/event/EventForm.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";

/**
 * A future protected host must supply the verified committed account identity
 * and a distinct generation for each authorization lifetime. Not derived from
 * a route, localStorage, Active X, role, or an unverified read. Never a token.
 * The server still authorizes every read and eventual mutation independently.
 */
export interface EventEditAuthority {
  authUserId: string;
  generation: string;
}

type EventEditProps = Pick<EventFormProps, "createEvent" | "updateEvent" | "router"> & {
  authority: EventEditAuthority | null;
  fetchFn?: OpsFetch;
  refreshKey?: number;
};

const loading = () => <p role="status" aria-busy="true">イベント設定を読み込み中…</p>;

/** No default write provider or new router registration. */
export function EventEdit(props: EventEditProps): React.ReactElement {
  const { id = "" } = useParams<{ id: string }>();
  const { authority, fetchFn, refreshKey = 0 } = props;
  const [provider, setProvider] = React.useState({ fetchFn, revision: 0 });
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    setProvider(previous => previous.fetchFn === fetchFn ? previous : {
      fetchFn, revision: previous.revision + 1,
    });
  }, [fetchFn]);
  // EventForm's existing draft owner normalization trims its input. Until
  // that contract is changed, do not let two different opaque IDs alias.
  if (!authority || !authority.authUserId ||
      authority.authUserId !== authority.authUserId.trim() || !authority.generation ||
      provider.fetchFn !== fetchFn) return loading();

  // Remount even on explicit refresh: fail closed before the next authorized
  // receipt; EventForm retains its existing draft flush/revision contract.
  // A -> B -> A mounts a new instance, never resurrects a prior read.
  const key = JSON.stringify([authority.authUserId, authority.generation, id,
    provider.revision, refreshKey, retry]);
  return <EventEditRead key={key} {...props} authority={authority} id={id}
    onRetry={() => setRetry(current => current + 1)} />;
}

function EventEditRead({
  id, authority, fetchFn, createEvent, updateEvent, router, onRetry,
}: Omit<EventEditProps, "authority"> & {
  id: string;
  authority: EventEditAuthority;
  onRetry: () => void;
}): React.ReactElement {
  const result = useApiResult(
    signal => readManageEventEdit(id, fetchFn, signal),
    "manage-event-edit:" + id,
  );
  if (result.status === "loading") return loading();
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status === "anonymous") return <p role="alert">ログインが必要です。</p>;
  if (result.status === "forbidden") return <p role="alert">イベントの編集権限がありません。</p>;
  if (result.status !== "ok" || result.data.draftAuthUserId !== authority.authUserId) {
    return <section role="alert">
      <p>イベント設定を取得できませんでした。</p>
      <button type="button" className="fn-btn fn-btn-ghost" onClick={onRetry}>イベント設定を再取得</button>
    </section>;
  }
  const data = result.data;
  if (!Object.values(data.editableSections).some(Boolean)) return <NotFoundView />;
  // The existing EventForm accepts optional numeric fields, while the wire
  // schema is nullable. Preserve explicit zero; use the existing defaults only
  // for null. No permission inference from isAdmin or Active X.
  const initial: EventFormInitial = {
    ...data.initial,
    allow_user_video_event_links: data.initial.allow_user_video_event_links ?? undefined,
    allow_unslotted_posts: data.initial.allow_unslotted_posts ?? undefined,
    allow_user_video_edits: data.initial.allow_user_video_edits ?? undefined,
    max_slots_per_video: data.initial.max_slots_per_video ?? undefined,
    max_slot_reservation_groups_per_xid: data.initial.max_slot_reservation_groups_per_xid ?? undefined,
  };
  const hrefId = encodeURIComponent(data.initial.id);
  return <div>
    <header className="fn-page-head">
      <OpsLink href={`/manage/events/${hrefId}`}>イベント概要へ</OpsLink>
      <h1>{data.initial.title}</h1>
      <p>イベントの基本設定・公開・投稿フォーム・枠ルールを編集します。</p>
    </header>
    <section className="manage-slot-quicklink" aria-label="枠設定へのショートカット">
      <strong>イベント枠を設定する</strong>
      <p>募集枠の生成・整理・予約状況の管理は、枠設定画面から行えます。</p>
      <OpsLink href={`/manage/events/${hrefId}/slots`} className="fn-btn fn-btn-primary">枠設定を開く</OpsLink>
    </section>
    <section className="manage-section">
      <EventForm mode="edit" variant="manage" initial={initial}
        draftAuthUserId={data.draftAuthUserId} editableSections={data.editableSections}
        createEvent={createEvent} updateEvent={updateEvent} router={router} />
    </section>
  </div>;
}
