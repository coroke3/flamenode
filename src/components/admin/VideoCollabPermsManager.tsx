"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  upsertVideoCollaborator,
  deleteVideoCollaborator,
} from "@/lib/actions/video-collab-perms";

/**
 * 合作メンバーの編集権限 (can_edit ON/OFF) を管理する UI。
 *
 * - subject 単位 (X ID または Discord user id) で 1 行
 * - 「編集権限あり」トグルをそのまま即時送信
 * - 新規追加フォーム (display_name + X ID)
 * - 解除ボタン → 確認ダイアログ
 *
 * 編集可能範囲そのものは、そのユーザーが他の手段 (admin / event editor 等) で
 * 持つ全体権限・イベント編集権限・creator 一致に従う。本 UI は「合作メンバー
 * として作品編集に入れるかのゲート」だけを切替える。
 */

export interface VideoCollabSubject {
  x_user_id: string | null;
  discord_user_id: string | null;
  display_name: string;
  can_edit: number;
}

interface Props {
  videoId: string;
  subjects: VideoCollabSubject[];
}

function subjectKey(s: VideoCollabSubject): string {
  return s.x_user_id ? `x:${s.x_user_id}` : `d:${s.discord_user_id ?? ""}`;
}

export function VideoCollabPermsManager({
  videoId,
  subjects,
}: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] =
    React.useState<VideoCollabSubject | null>(null);

  const submitUpsert = (
    subject: VideoCollabSubject | { x_user_id?: string; discord_user_id?: string | null; display_name: string },
    canEdit: boolean,
  ) => {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    if (subject.x_user_id) fd.set("x_user_id", subject.x_user_id);
    if (subject.discord_user_id) fd.set("discord_user_id", subject.discord_user_id);
    fd.set("display_name", subject.display_name);
    fd.set("can_edit", canEdit ? "1" : "0");
    startTransition(async () => {
      const r = await upsertVideoCollaborator(fd);
      if (!r.ok) {
        setError(r.message ?? "更新に失敗しました。");
        return;
      }
      setMessage(r.message ?? "更新しました。");
      router.refresh();
    });
  };

  const submitDelete = (subject: VideoCollabSubject) => {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    if (subject.x_user_id) fd.set("x_user_id", subject.x_user_id);
    if (subject.discord_user_id)
      fd.set("discord_user_id", subject.discord_user_id);
    startTransition(async () => {
      const r = await deleteVideoCollaborator(fd);
      if (!r.ok) {
        setError(r.message ?? "解除に失敗しました。");
        return;
      }
      setMessage(r.message ?? "解除しました。");
      router.refresh();
    });
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        合作メンバーに作品の編集権限を付与します。X ID 未連携のメンバーにも
        先付与でき、後で Discord 連携・承認されたタイミングで自動的に有効化されます。
        編集可能な範囲は、そのユーザーが他の手段で持つ権限に従います。
      </p>

      {subjects.length === 0 ? (
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          まだ参加者の編集権限は設定されていません。
        </p>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "grid",
            gap: 8,
          }}
        >
          {subjects.map((s) => (
            <li
              key={subjectKey(s)}
              style={{
                padding: 10,
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-surface)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <strong>{s.display_name}</strong>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {s.x_user_id
                    ? `@${s.x_user_id}`
                    : s.discord_user_id
                      ? `discord:${s.discord_user_id.slice(0, 12)}…`
                      : "(subject 未設定)"}
                </div>
              </div>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  cursor: pending ? "not-allowed" : "pointer",
                }}
                title="編集権限あり / なし"
              >
                <input
                  type="checkbox"
                  checked={s.can_edit === 1}
                  disabled={pending}
                  onChange={(e) => submitUpsert(s, e.target.checked)}
                />
                編集権限あり
              </label>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                disabled={pending}
                onClick={() => setConfirmDelete(s)}
              >
                <Icon name="trash" size={11} aria-hidden /> 解除
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddSubjectForm
        pending={pending}
        onAdd={(name, xUserId, canEdit) =>
          submitUpsert(
            { x_user_id: xUserId, display_name: name },
            canEdit,
          )
        }
      />

      {message ? (
        <p
          className="fn-text-sm"
          style={{ color: "var(--text-secondary)", margin: 0 }}
        >
          <Icon name="check" size={12} aria-hidden /> {message}
        </p>
      ) : null}
      {error ? (
        <p
          className="fn-text-sm"
          role="alert"
          style={{ color: "var(--accent-danger)", margin: 0 }}
        >
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        title="参加者の編集権限を解除しますか?"
        message={
          confirmDelete
            ? `${confirmDelete.display_name} (${
                confirmDelete.x_user_id
                  ? `@${confirmDelete.x_user_id}`
                  : `discord:${confirmDelete.discord_user_id}`
              }) の編集権限を解除します。`
            : ""
        }
        confirmLabel="解除する"
        tone="danger"
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) submitDelete(target);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function AddSubjectForm({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (displayName: string, xUserId: string, canEdit: boolean) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [xUserId, setXUserId] = React.useState("");
  const canSubmit =
    name.trim().length > 0 && xUserId.trim().length > 0 && !pending;

  if (!open) {
    return (
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={() => setOpen(true)}
        disabled={pending}
        style={{ alignSelf: "flex-start" }}
      >
        <Icon name="plus" size={11} aria-hidden /> 参加者を追加
      </button>
    );
  }

  return (
    <div
      style={{
        padding: 12,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          className="fn-input"
          placeholder="表示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          style={{ flex: "1 1 160px" }}
        />
        <input
          type="text"
          className="fn-input"
          placeholder="X ID (@ なし)"
          value={xUserId}
          onChange={(e) => setXUserId(e.target.value)}
          pattern="[A-Za-z0-9_]{1,32}"
          style={{ flex: "1 1 140px" }}
        />
      </div>
      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        追加後はデフォルトで「編集権限あり」になります。後でトグルで無効化できます。
      </p>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={!canSubmit}
          onClick={() => {
            onAdd(name.trim(), xUserId.trim(), true);
            setName("");
            setXUserId("");
            setOpen(false);
          }}
        >
          <Icon name="plus" size={11} aria-hidden /> 追加
        </button>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setName("");
            setXUserId("");
          }}
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
