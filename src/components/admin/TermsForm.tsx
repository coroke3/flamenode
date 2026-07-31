"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  archiveTermsVersion,
  createTermsVersion,
  publishTermsVersion,
  updateTermsVersion,
} from "@/lib/actions/rules";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";
import styles from "./TermsForm.module.css";

export interface TermsInitial {
  id?: string;
  version_label?: string;
  body_markdown?: string;
  severity?: "minor" | "major";
  status?: "draft" | "published" | "archived";
}

interface Props {
  mode: "create" | "edit";
  initial?: TermsInitial;
}

export function TermsForm({ mode, initial = {} }: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);
  const [confirmKind, setConfirmKind] = React.useState<"publish" | "archive" | null>(null);
  const readOnly = mode === "edit" && initial.status !== "draft";

  const handle = (fd: FormData, fn: typeof createTermsVersion, ok: string) => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await fn(fd);
      if (!r.ok) {
        setError(r.message ?? "失敗しました。");
        return;
      }
      setSuccess({
        message: ok,
        pendingPublicReflection: r.pendingPublicReflection,
      });
      if (mode === "create" && r.id) {
        router.push(`/admin/rules/${r.id}/edit`);
      } else {
        router.refresh();
      }
    });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    handle(
      fd,
      mode === "create" ? createTermsVersion : updateTermsVersion,
      "保存しました。",
    );
  };

  const onPublish = () => {
    if (!initial.id) return;
    setConfirmKind("publish");
  };

  const onArchive = () => {
    if (!initial.id) return;
    setConfirmKind("archive");
  };

  const handlePublishConfirm = () => {
    if (!initial.id) return;
    setConfirmKind(null);
    const fd = new FormData();
    fd.set("id", initial.id);
    handle(fd, publishTermsVersion, "公開しました。");
  };

  const handleArchiveConfirm = () => {
    if (!initial.id) return;
    setConfirmKind(null);
    const fd = new FormData();
    fd.set("id", initial.id);
    handle(fd, archiveTermsVersion, "アーカイブしました。");
  };

  return (
    <>
    <form
      onSubmit={onSubmit}
      className={styles.form}
    >
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className={styles.metaGrid}>
        <div>
          <label className="fn-label">バージョンラベル *</label>
          <input
            name="version_label"
            type="text"
            defaultValue={initial.version_label ?? ""}
            className="fn-input"
            maxLength={80}
            required
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="fn-label">重要度</label>
          <select
            name="severity"
            defaultValue={initial.severity ?? "minor"}
            className="fn-select"
            disabled={readOnly}
          >
            <option value="minor">minor (再同意なし)</option>
            <option value="major">major (再同意要求)</option>
          </select>
        </div>
      </div>
      <div>
        <label className="fn-label">本文 (Markdown) *</label>
        <textarea
          name="body_markdown"
          defaultValue={initial.body_markdown ?? ""}
          rows={20}
          maxLength={40000}
          required
          readOnly={readOnly}
          className={`fn-input ${styles.markdown}`}
        />
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          {readOnly
            ? `${initial.status} 状態のため編集不可。新規バージョンを作成してください。`
            : "下書き状態のときだけ編集できます。公開すると変更不可になります。"}
        </p>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <SaveSuccessNotice
          message={
            <>
              <Icon name="check" size={12} aria-hidden /> {success.message}
            </>
          }
          pendingPublicReflection={success.pendingPublicReflection}
          style={{ color: "var(--accent-primary)", fontSize: 12 }}
        />
      ) : null}

      <div className={styles.actions}>
        {!readOnly ? (
          <button
            type="submit"
            className="fn-btn fn-btn-primary"
            disabled={busy}
            aria-busy={busy}
          >
            <Icon name="check" size={13} aria-hidden />
            {busy ? "保存中…" : mode === "create" ? "下書き作成" : "下書き保存"}
          </button>
        ) : null}
        {mode === "edit" && initial.status === "draft" ? (
          <button
            type="button"
            className="fn-btn fn-btn-warning"
            disabled={busy}
            onClick={onPublish}
          >
            <Icon name="upload" size={13} aria-hidden /> 公開
          </button>
        ) : null}
        {mode === "edit" && initial.status === "published" ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost"
            disabled={busy}
            onClick={onArchive}
          >
            <Icon name="trash" size={13} aria-hidden /> アーカイブ
          </button>
        ) : null}
      </div>
    </form>
    <ConfirmDialog
      open={confirmKind === "publish"}
      title="利用規約を公開"
      message={
        initial.severity === "major"
          ? "major リリースとして公開します。全ユーザーに再同意を要求します。"
          : "minor リリースとして公開します。"
      }
      confirmLabel="公開する"
      cancelLabel="キャンセル"
      tone={initial.severity === "major" ? "danger" : "default"}
      onConfirm={handlePublishConfirm}
      onCancel={() => setConfirmKind(null)}
    />
    <ConfirmDialog
      open={confirmKind === "archive"}
      title="バージョンをアーカイブ"
      message="このバージョンを archived にします。この操作は取り消せません。"
      confirmLabel="アーカイブ"
      cancelLabel="キャンセル"
      tone="danger"
      onConfirm={handleArchiveConfirm}
      onCancel={() => setConfirmKind(null)}
    />
    </>
  );
}
