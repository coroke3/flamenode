/** MIG-0727 U03b: unmounted terms lifecycle forms.
 * CURRENT src/components/admin/TermsForm.tsx; server enforces status and CAS.
 * No Ops router registrations, broadcast controls, or production writes here.
 */
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AdminRuleDetailResponse } from "@flamenode/contracts";
import { createAdminTermsApi } from "../../api/adminTerms.js";
import { readAdminRuleDetail } from "../../api/adminRules.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult } from "../useApiResult.js";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.js";

type Api = ReturnType<typeof createAdminTermsApi>;
type Detail = AdminRuleDetailResponse["item"];
export type TermsInitial = {
  id?: string;
  version_label?: string;
  body_markdown?: string;
  severity?: "minor" | "major";
  status?: "draft" | "published" | "archived";
};

export function TermsForm({ mode, initial = {}, api, onSaved }: {
  mode: "create" | "edit"; initial?: TermsInitial; api: Api;
  onSaved: (id: string, pendingReflection?: boolean) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [confirmKind, setConfirmKind] = React.useState<"publish" | "archive" | null>(null);
  const readOnly = mode === "edit" && initial.status !== "draft";

  async function run(task: () => ReturnType<Api["publish"]>, message: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await task();
      if (!result.ok) { setError(result.message ?? "失敗しました。"); return; }
      const id = result.id ?? initial.id;
      if (!id) { setError("保存に失敗しました。再読み込みしてください。"); return; }
      setSuccess(result.pendingPublicReflection ? message + " 公開側への反映待ちです。" : message);
      onSaved(id, result.pendingPublicReflection);
    } catch {
      setError("保存に失敗しました。再読み込みしてください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (readOnly || (mode === "edit" && !initial.id)) return;
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    void run(
      () => mode === "create" ? api.createDraft(raw) : api.updateDraft(initial.id!, raw),
      "保存しました。",
    );
  }

  function confirmAction(): void {
    if (busyRef.current || mode !== "edit" || !initial.id) return;
    const kind = confirmKind;
    if (kind === "publish" && initial.status !== "draft") return;
    if (kind === "archive" && initial.status !== "published") return;
    setConfirmKind(null);
    if (kind === "publish") void run(() => api.publish(initial.id!), "公開しました。");
    if (kind === "archive") void run(() => api.archive(initial.id!), "アーカイブしました。");
  }

  return <>
    <form onSubmit={submit} aria-label={mode === "create" ? "規約の新規作成" : "規約の編集"}
      style={{ display: "grid", gap: 14 }}>
      {mode === "edit" && initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <label className="fn-field">バージョンラベル *
          <input className="fn-input" name="version_label" maxLength={80} required type="text"
            defaultValue={initial.version_label ?? ""} readOnly={readOnly} disabled={busy} /></label>
        <label className="fn-field">重要度
          <select className="fn-select" name="severity" defaultValue={initial.severity ?? "minor"}
            disabled={busy || readOnly}>
            <option value="minor">minor (再同意なし)</option>
            <option value="major">major (再同意要求)</option>
          </select></label>
      </div>
      <label className="fn-field">本文 (Markdown) *
        <textarea className="fn-input" name="body_markdown" rows={20} maxLength={40000} required
          defaultValue={initial.body_markdown ?? ""} readOnly={readOnly} disabled={busy} /></label>
      <p className="fn-muted">{readOnly
        ? `${initial.status ?? "不明"} 状態のため編集不可。新規バージョンを作成してください。`
        : "下書き状態のときだけ編集できます。公開すると変更不可になります。"}</p>
      {error ? <p role="alert" className="fn-alert fn-alert-danger">{error}</p> : null}
      {success ? <p role="status" className="fn-alert fn-alert-success">{success}</p> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!readOnly ? <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}
          aria-busy={busy}>{busy ? "保存中…" : mode === "create" ? "下書き作成" : "下書き保存"}</button> : null}
        {mode === "edit" && initial.status === "draft" ? <button type="button"
          className="fn-btn fn-btn-warning" disabled={busy || !initial.id}
          onClick={() => setConfirmKind("publish")}>公開</button> : null}
        {mode === "edit" && initial.status === "published" ? <button type="button"
          className="fn-btn fn-btn-ghost" disabled={busy || !initial.id}
          onClick={() => setConfirmKind("archive")}>アーカイブ</button> : null}
      </div>
    </form>
    <ConfirmDialog open={confirmKind === "publish"} title="利用規約を公開"
      message={initial.severity === "major"
        ? "major リリースとして公開します。全ユーザーに再同意を要求します。"
        : "minor リリースとして公開します。"}
      confirmLabel="公開する" cancelLabel="キャンセル"
      tone={initial.severity === "major" ? "danger" : "default"} busy={busy}
      onConfirm={confirmAction} onCancel={() => setConfirmKind(null)} />
    <ConfirmDialog open={confirmKind === "archive"} title="バージョンをアーカイブ"
      message="このバージョンを archived にします。この操作は取り消せません。"
      confirmLabel="アーカイブ" cancelLabel="キャンセル" tone="danger" busy={busy}
      onConfirm={confirmAction} onCancel={() => setConfirmKind(null)} />
  </>;
}

/** Requires the MIG-0726 owner to supply CURRENT's default version label and Markdown. */
export function AdminRuleCreatePage({ initial, fetchFn }: {
  initial: Required<Pick<TermsInitial, "version_label" | "body_markdown" | "severity">>;
  fetchFn?: OpsFetch;
}): React.ReactElement {
  const navigate = useNavigate();
  const api = createAdminTermsApi(fetchFn);
  return <section className="fn-page" aria-label="新規利用規約バージョン">
    <header className="fn-page-head"><h1 className="fn-page-title">新規利用規約バージョン</h1>
      <p>下書きとして保存し、編集ページから公開してください。major リリースで公開すると全ユーザーに再同意を要求します。</p>
      <Link to="/admin/rules">規約一覧へ</Link></header>
    <TermsForm mode="create" initial={initial} api={api}
      onSaved={id => navigate(`/admin/rules/${encodeURIComponent(id)}/edit`)} />
  </section>;
}

/** Unmounted edit route. Missing detail, lost session or permissions never mount write controls. */
export function AdminRuleEditPage({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const { id = "" } = useParams();
  const [refreshKey, refresh] = React.useReducer(n => n + 1, 0);
  const api = createAdminTermsApi(fetchFn);
  const result = useApiResult(signal => readAdminRuleDetail(id, fetchFn, signal), "admin-rule-edit:" + id, refreshKey);
  if (result.status === "loading") return <p role="status">読み込み中…</p>;
  if (result.status === "anonymous") return <p>ログインが必要です。<Link to="/entry">ログイン</Link></p>;
  if (result.status === "forbidden") return <p>管理者権限が必要です。<Link to="/dashboard">ダッシュボードへ</Link></p>;
  if (result.status === "notFound") return <p role="alert">規約が見つかりません。</p>;
  if (result.status !== "ok") return <p role="alert">規約を取得できませんでした。再読み込みしてください。</p>;
  const item: Detail = result.data.item;
  const initial: TermsInitial = {
    id: item.id, version_label: item.version_label, body_markdown: item.body_markdown,
    status: item.status === "draft" || item.status === "published" || item.status === "archived"
      ? item.status : undefined,
    severity: item.severity === "major" || item.severity === "minor" ? item.severity : undefined,
  };
  return <section className="fn-page" aria-label="規約バージョン編集">
    <header className="fn-page-head"><h1 className="fn-page-title">{item.version_label} を編集</h1>
      <Link to="/admin/rules">規約一覧へ</Link></header>
    <TermsForm key={item.id + ":" + item.status + ":" + item.version_label} mode="edit"
      initial={initial} api={api} onSaved={() => refresh()} />
  </section>;
}
