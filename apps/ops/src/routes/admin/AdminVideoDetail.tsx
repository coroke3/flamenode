import * as React from "react";
import { useLocation, useParams } from "react-router-dom";
import type { AdminVideoDetailResponse } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import {
  adminVideoBackHref,
  formatAdminVideoUnix,
  loadAdminVideoDetail,
  selectOpenVoidCaseId,
} from "../../api/adminVideoDetail.js";
import {
  createAdminVideoStatusActions,
  createModerationCaseAction,
  type AdminVideoMutation,
  type AdminVideoMutationResult,
} from "../../api/adminVideoStatus.js";
import { useApiResult } from "../useApiResult.js";
import { CreateModerationCaseForm } from "./CreateModerationCaseForm.js";
import { SaveSuccessNotice } from "../../components/shared/SaveSuccessNotice.js";
import { AdminResourceTabs } from "../../components/shared/AdminResourceTabs.js";

const browserFetch: OpsFetch = (path, init) => fetch(path, init);
const STATUS_OPTIONS = ["pending", "public", "private", "voided"] as const;
const VOID_CATEGORIES = ["x_id_invalid", "duplicate", "withdrawn_by_creator", "operator_decision", "expired"] as const;


/** CURRENT AdminVideoTabs: preserve cross-SPA links, icons and active detail state. */
export function AdminVideoTabs({ videoId, youtubeVideoId, active = "detail" }: {
  videoId: string;
  youtubeVideoId?: string | null;
  active?: "detail" | "members" | "edit" | "permissions" | "public" | "audit";
}): React.ReactElement {
  const id = encodeURIComponent(videoId);
  const publicId = encodeURIComponent(youtubeVideoId?.trim() || videoId);
  return <AdminResourceTabs
    active={active}
    ariaLabel="作品管理メニュー"
    tabs={[
      { key: "detail", href: `/admin/videos/${id}`, label: "管理詳細", icon: "info" },
      { key: "members", href: `/admin/videos/${id}/members`, label: "メンバー", icon: "users" },
      { key: "edit", href: `/dashboard/edit/${id}?privileged=admin`, label: "内容編集", icon: "edit" },
      { key: "permissions", href: `/dashboard/edit/${id}/permissions?privileged=admin`, label: "編集権限", icon: "settings" },
      { key: "public", href: `/${publicId}`, label: "公開ページ", icon: "external" },
      { key: "audit", href: `/admin/audit?table=videos&record=${id}`, label: "監査ログ", icon: "clock" },
    ]}
  />;
}

function Field({ name, value }: { name: string; value: React.ReactNode }): React.ReactElement {
  return <><dt className="fn-muted">{name}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{value ?? "—"}</dd></>;
}
function InfoPanel({ data }: { data: AdminVideoDetailResponse }): React.ReactElement {
  const v = data.video;
  const youtubeId = v.youtube_video_id?.trim();
  return (
    <section>
      {youtubeId && /^[a-zA-Z0-9_-]{11}$/.test(youtubeId) ? (
        <img src={`https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`}
          alt="" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover" }} />
      ) : v.source_type === "youtube" ? (
        <p>YouTube URL: 未設定（動画情報のみ公開できます。後から追加可能です）</p>
      ) : null}
      <dl className="fn-card" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
        <Field name="状態" value={v.visibility_status} />
        <Field name="作者" value={`${v.creator_name}${v.creator_x_user_id ? ` (@${v.creator_x_user_id})` : ""}`} />
        <Field name="YouTube ID" value={youtubeId ? <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`} target="_blank" rel="noopener noreferrer">{youtubeId}</a> : "なし"} />
        <Field name="楽曲" value={v.music} />
        <Field name="クレジット" value={v.credit} />
        <Field name="使用ソフト" value={v.software_label} />
        <Field name="intro_comment" value={v.intro_comment} />
        <Field name="highlights" value={v.highlights} />
        <Field name="production_story" value={v.production_story} />
        <Field name="権利確認" value={v.stagePermission} />
      </dl>
      {v.customAnswers.length ? (
        <section className="fn-card">
          <h2>カスタム質問回答</h2>
          <dl>{v.customAnswers.map((q, i) => (
            <div key={`${q.label}:${i}`}>
              <dt>{q.label} {q.required ? <span className="fn-badge">必須</span> : null}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{q.answer}</dd>
            </div>
          ))}</dl>
        </section>
      ) : null}
      {v.members.length ? (
        <section className="fn-card">
          <h2>メンバー</h2>
          <table className="fn-table"><thead><tr><th>名前</th><th>役割</th><th>X ID</th><th>チャプター</th></tr></thead>
            <tbody>{v.members.map((m, i) => (
              <tr key={`${m.name}:${i}`}>
                <td>{m.name} {!m.is_public_member ? <span className="fn-badge">非公開</span> : null}</td>
                <td>{m.role ?? "—"}</td><td>{m.x_user_id ? `@${m.x_user_id}` : "—"}</td>
                <td>{m.chapters ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}

export function StatusControls({
  data, eventId, onRefresh, actions,
}: {
  data: AdminVideoDetailResponse;
  eventId: string | null;
  onRefresh: () => void;
  actions: ReturnType<typeof createAdminVideoStatusActions>;
}): React.ReactElement {
  const v = data.video;
  const [selected, setSelected] = React.useState(v.visibility_status);
  const [reason, setReason] = React.useState("");
  const [category, setCategory] = React.useState<string>("operator_decision");
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string; pendingPublicReflection?: boolean } | null>(null);
  const openCase = selectOpenVoidCaseId(data.moderationCases);

  // A successful mutation refreshes the same video with a new status. Keep its
  // success / delayed-public-reflection notice visible across that refresh.
  React.useEffect(() => { setSelected(v.visibility_status); }, [v.id, v.visibility_status]);
  React.useEffect(() => { setMessage(null); }, [v.id]);
  async function run(action: AdminVideoMutation, form: FormData): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      form.set("video_id", v.id);
      if (eventId) form.set("review_event_id", eventId);
      const result: AdminVideoMutationResult = await action(form);
      if (result.ok) {
        setMessage({
          ok: true,
          text: result.message ?? "更新しました。",
          pendingPublicReflection: result.pendingPublicReflection === true,
        });
        setReason("");
        if (result.nextHref) {
          window.location.assign(result.nextHref);
        } else onRefresh();
      } else {
        setMessage({ ok: false, text: result.message ?? "更新に失敗しました。" });
        if (result.retryable) onRefresh();
      }
    } catch {
      setMessage({ ok: false, text: "通信状態を確認し、作品を再取得してください。" });
      onRefresh();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  function statusForm(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selected === v.visibility_status) return;
    if (selected === "voided" && !reason.trim()) {
      setMessage({ ok: false, text: "このステータスへ変更するには理由が必要です。" }); return;
    }
    if (v.visibility_status === "voided" && selected !== "voided" && !openCase) {
      setMessage({ ok: false, text: "voided解除には open な moderation case_id が必要です。" }); return;
    }
    const fd = new FormData();
    fd.set("status", selected);
    fd.set("reason", reason);
    if (selected === "voided") fd.set("void_reason_category", category);
    if (v.visibility_status === "voided" && selected !== "voided" && openCase) fd.set("case_id", openCase);
    void run(actions.setStatus, fd);
  }

  return (
    <section className="fn-card" aria-label="作品の状態変更">
      <h2>状態変更</h2>
      <p>登録: {formatAdminVideoUnix(v.created_at)}</p>
      {v.visibility_status === "pending" ? (
        <div className="fn-panel-actions">
          <button type="button" className="fn-btn fn-btn-primary" disabled={pending}
            onClick={() => { const fd = new FormData(); void run(actions.approve, fd); }}>承認</button>
          <button type="button" className="fn-btn fn-btn-ghost" disabled={pending}
            onClick={() => { const fd = new FormData(); void run(actions.approveAndNext, fd); }}>承認して次へ</button>
        </div>
      ) : null}
      <form onSubmit={statusForm} style={{ display: "grid", gap: 8 }}>
        <label>変更先ステータス
          <select className="fn-select" value={selected} onChange={e => setSelected(e.target.value)} disabled={pending}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {selected === "voided" && v.visibility_status !== "voided" ? (
          <>
            <label>無効化カテゴリ
              <select className="fn-select" value={category} onChange={e => setCategory(e.target.value)} disabled={pending}>
                {VOID_CATEGORIES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label>理由 (必須)
              <textarea className="fn-input" rows={3} maxLength={500} value={reason}
                onChange={e => setReason(e.target.value)} disabled={pending} />
            </label>
          </>
        ) : null}
        {v.visibility_status === "voided" && selected !== "voided" ? (
          <p>{openCase
            ? `voided解除に case_id=${openCase} を送信します。`
            : "voided解除には open な moderation case が必要です。先にケースを確認してください。"}</p>
        ) : null}
        <button className="fn-btn fn-btn-primary" type="submit" aria-busy={pending}
          disabled={pending || selected === v.visibility_status ||
            (v.visibility_status === "voided" && selected !== "voided" && !openCase)}>
          適用
        </button>
      </form>
      {message
        ? message.ok
          ? <SaveSuccessNotice message={message.text} pendingPublicReflection={message.pendingPublicReflection} />
          : <p role="alert">{message.text}</p>
        : null}
    </section>
  );
}

function ModerationCases({ data, create, onRefresh }: {
  data: AdminVideoDetailResponse;
  create: AdminVideoMutation;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <section className="fn-card" aria-label="モデレーションケース">
      <h2>モデレーションケース</h2>
      <p>未解決 {data.openCaseCount} 件 / 直近 {data.moderationCases.length} 件</p>
      {data.moderationCases.length ? data.moderationCases.map(item => (
        <details key={item.id}>
          <summary>{item.status} {item.case_type} {formatAdminVideoUnix(item.created_at)}</summary>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
            <Field name="期限" value={formatAdminVideoUnix(item.due_at)} />
            <Field name="関連X ID" value={item.related_x_user_id ? `@${item.related_x_user_id}` : "—"} />
            <Field name="公開理由" value={item.public_reason} />
            <Field name="内部メモ" value={item.private_note} />
            <Field name="解決日時" value={formatAdminVideoUnix(item.resolved_at)} />
          </dl>
        </details>
      )) : <p>この作品のケースはまだありません。</p>}
      <CreateModerationCaseForm videoId={data.video.id} action={create} onRefresh={onRefresh} />
    </section>
  );
}

/**
 * MIG-0729 U02: isolated admin detail consumer.
 * Deliberately UNMOUNTED pending MIG-0603 write API and MIG-0726 Admin shell.
 */
export function AdminVideoDetail({ fetchFn = browserFetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id = "" } = useParams<{ id: string }>();
  const { search } = useLocation();
  const eventId = React.useMemo(() => new URLSearchParams(search).get("event") || null, [search]);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const refresh = React.useCallback(() => setRefreshKey(x => x + 1), []);
  const load = React.useCallback(
    (signal: AbortSignal) => loadAdminVideoDetail(fetchFn, id, eventId, signal),
    [fetchFn, id, eventId],
  );
  const result = useApiResult(load, JSON.stringify([id, eventId]), refreshKey);
  const actions = React.useMemo(() => createAdminVideoStatusActions(fetchFn), [fetchFn]);
  const createCase = React.useMemo(() => createModerationCaseAction(fetchFn), [fetchFn]);

  if (result.status === "loading") return <section role="status" aria-busy="true">作品詳細を読み込み中...</section>;
  if (result.status !== "ok") return (
    <section role="alert"><h1>作品詳細</h1>
      <p>{result.status === "notFound" ? "対象作品が見つかりません。"
        : result.status === "anonymous" ? "ログインが必要です。"
        : result.status === "forbidden" ? "管理者権限がありません。"
        : "作品詳細を取得できませんでした。"}</p>
    </section>
  );

  const data = result.data;
  const video = data.video;
  const slug = encodeURIComponent(video.id);
  const publicSlug = encodeURIComponent(video.youtube_video_id?.trim() || video.id);
  return (
    <section className="fn-public-container fn-page">
      <header className="fn-page-head">
        <a href={adminVideoBackHref(eventId)}>作品一覧へ</a>
        <h1>{video.title}</h1>
        <p>作者: {video.creator_name}{video.creator_x_user_id ? ` (@${video.creator_x_user_id})` : ""}</p>
      </header>
      <AdminVideoTabs videoId={video.id} youtubeVideoId={video.youtube_video_id} active="detail" />
      {data.truncated ? <p role="status">一部の項目は件数上限により省略されています。</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 20 }}>
        <InfoPanel data={data} />
        <aside>
          <StatusControls data={data} eventId={eventId} onRefresh={refresh} actions={actions} />
          <nav aria-label="作品の関連画面" className="fn-panel-actions">
            <a href={`/${publicSlug}`} target="_blank" rel="noopener noreferrer">公開ページ</a>
            <a href={`/dashboard/edit/${slug}?privileged=admin`}>編集画面</a>
            <a href={`/admin/videos/${slug}/members`}>参加者設定</a>
          </nav>
        </aside>
      </div>
      <ModerationCases data={data} create={createCase} onRefresh={refresh} />
    </section>
  );
}
