/** MIG-0727 U02b: unmounted Ops announcement create/edit/delete screens.
 * CURRENT: AnnouncementForm, DeleteAnnouncementForm, announcements/new and [id]/edit.
 * Route registration stays with MIG-0726; server reauthorizes all mutations.
 */
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AdminAnnouncementDetailResponse } from "@flamenode/contracts";
import { createAdminAnnouncementsApi } from "../../api/adminAnnouncementWrite.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult } from "../useApiResult.js";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.js";

type Detail = AdminAnnouncementDetailResponse["item"];
type Api = ReturnType<typeof createAdminAnnouncementsApi>;

const jstLocalFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export function announcementDatetimeLocal(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = jstLocalFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function AnnouncementForm({ mode, initial, api, onSaved }: {
  mode: "create" | "edit";
  initial?: Detail;
  api: Api;
  onSaved: (id: string | undefined) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busyRef.current || (mode === "edit" && !initial?.id)) return;
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = mode === "create"
        ? await api.create(raw)
        : await api.update(initial!.id, raw);
      if (!result.ok) { setError(result.message ?? "失敗しました。"); return; }
      if (mode === "create" && !result.id) {
        setError("保存に失敗しました。再読み込みして、もう一度お試しください。");
        return;
      }
      setSuccess("保存しました。");
      onSaved(result.id);
    } catch {
      setError("保存に失敗しました。再読み込みして、もう一度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={e => void submit(e)} aria-label={mode === "create" ? "お知らせ作成" : "お知らせ編集"}
    style={{ display: "grid", gap: 16, maxWidth: 900 }}>
    {mode === "edit" && initial ? <>
      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="base_updated_at" value={String(initial.updated_at)} />
    </> : null}
    <label className="fn-field"><span className="fn-label">タイトル *</span>
      <input className="fn-input" name="title" type="text" maxLength={200}
        defaultValue={initial?.title ?? ""} required disabled={busy} /></label>
    <label className="fn-field"><span className="fn-label">本文 (Markdown) *</span>
      <textarea className="fn-input" name="body" rows={8} maxLength={8000}
        defaultValue={initial?.body ?? ""} required disabled={busy} /></label>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      <label className="fn-field"><span className="fn-label">重要度</span>
        <select className="fn-select" name="severity" defaultValue={initial?.severity ?? "info"} disabled={busy}>
          <option value="info">info</option><option value="warning">warning</option>
          <option value="danger">danger</option>
        </select></label>
      <label className="fn-field"><span className="fn-label">対象</span>
        <select className="fn-select" name="target_audience" defaultValue={initial?.target_audience ?? "all"} disabled={busy}>
          <option value="all">全員</option><option value="creators">クリエイター</option>
          <option value="admins">管理者</option>
        </select></label>
      <label className="fn-field"><span className="fn-label">公開</span>
        <select className="fn-select" name="is_published" defaultValue={String(initial?.is_published ?? 0)} disabled={busy}>
          <option value="0">下書き</option><option value="1">公開</option>
        </select></label>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
      <label className="fn-field"><span className="fn-label">掲載開始</span>
        <input className="fn-input" type="datetime-local" name="publish_at"
          defaultValue={announcementDatetimeLocal(initial?.publish_at)} disabled={busy} /></label>
      <label className="fn-field"><span className="fn-label">掲載終了</span>
        <input className="fn-input" type="datetime-local" name="expire_at"
          defaultValue={announcementDatetimeLocal(initial?.expire_at)} disabled={busy} /></label>
    </div>
    {error ? <p role="alert" className="fn-alert fn-alert-danger">{error}</p> : null}
    {success ? <p role="status" className="fn-alert fn-alert-success">{success}</p> : null}
    <div><button className="fn-btn fn-btn-primary" type="submit" disabled={busy || (mode === "edit" && !initial?.id)}
      aria-busy={busy}>{busy ? "保存中…" : mode === "create" ? "作成" : "保存"}</button></div>
  </form>;
}

export function DeleteAnnouncementButton({ id, api, onDeleted }: {
  id: string; api: Api; onDeleted: () => void;
}): React.ReactElement {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  async function remove(): Promise<void> {
    if (busyRef.current || !id) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmOpen(false);
    setError(null);
    try {
      const result = await api.delete(id);
      if (result.ok) onDeleted();
      else setError(result.message ?? "削除に失敗しました。");
    } catch {
      setError("削除に失敗しました。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return <section aria-label="お知らせ削除">
    <h2>削除</h2>
    <button type="button" className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy || !id}
      onClick={() => setConfirmOpen(true)}>{busy ? "削除中…" : "削除"}</button>
    {error ? <p role="alert" className="fn-alert fn-alert-danger">{error}</p> : null}
    <ConfirmDialog open={confirmOpen} title="お知らせを削除"
      message="このお知らせを削除します。この操作は取り消せません。"
      confirmLabel="削除" cancelLabel="キャンセル" tone="danger" busy={busy}
      onConfirm={() => void remove()} onCancel={() => setConfirmOpen(false)} />
  </section>;
}

/** Route candidate only; keep unmounted until MIG-0726 routing is released. */
export function AnnouncementCreatePage({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const api = createAdminAnnouncementsApi(fetchFn);
  const navigate = useNavigate();
  return <section className="fn-page" aria-label="新規お知らせ">
    <header className="fn-page-head"><h1 className="fn-page-title">新規お知らせ</h1>
      <Link to="/admin/announcements">お知らせ一覧へ</Link></header>
    <AnnouncementForm mode="create" api={api}
      onSaved={id => { if (id) navigate(`/admin/announcements/${encodeURIComponent(id)}/edit`); }} />
  </section>;
}

/** A 404/401/403 never mounts a previously loaded edit form or delete control. */
export function AnnouncementEditPage({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id = "" } = useParams();
  const api = createAdminAnnouncementsApi(fetchFn);
  const navigate = useNavigate();
  const [refreshKey, refresh] = React.useReducer(n => n + 1, 0);
  const result = useApiResult(signal => api.read(id, signal), "admin-announcement-edit:" + id, refreshKey);
  if (result.status === "loading") return <p role="status">読み込み中…</p>;
  if (result.status === "anonymous") return <p>ログインが必要です。<Link to="/entry">ログイン</Link></p>;
  if (result.status === "forbidden") return <p>管理者権限が必要です。<Link to="/dashboard">ダッシュボードへ</Link></p>;
  if (result.status === "notFound") return <p role="alert">お知らせが見つかりません。</p>;
  if (result.status !== "ok") return <p role="alert">お知らせを取得できませんでした。再読み込みしてください。</p>;
  const item = result.data.item;
  return <section className="fn-page" aria-label="お知らせ編集画面">
    <header className="fn-page-head"><h1 className="fn-page-title">{item.title} を編集</h1>
      <Link to="/admin/announcements">お知らせ一覧へ</Link>
      <Link to={`/admin/audit?table=announcements&record=${encodeURIComponent(item.id)}`}>監査ログ</Link>
    </header>
    <AnnouncementForm key={item.id + ":" + item.updated_at} mode="edit" initial={item} api={api}
      onSaved={() => refresh()} />
    <DeleteAnnouncementButton key={item.id} id={item.id} api={api}
      onDeleted={() => navigate("/admin/announcements")} />
  </section>;
}
