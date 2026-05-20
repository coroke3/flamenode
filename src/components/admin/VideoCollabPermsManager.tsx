"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  upsertVideoCollaboratorPermissions,
  deleteVideoCollaboratorPermissions,
} from "@/lib/actions/video-collab-perms";

/**
 * 作品単位の参加者編集権限を管理する UI。
 *
 * 主となるユーザー (作者 / admin / イベント運営の identity 権限保持者) が、
 * 合作メンバーに section 別の編集権限を付与する。
 *
 * - subject 単位 (X ID または Discord user id) に行を表示
 * - 各行ごとに 5 つの permission をチェックボックスで切替
 * - 新規追加: display_name + X ID を入れて「追加」ボタン
 * - 削除: 行ごとの「権限を解除」ボタン (Confirm)
 *
 * permission_key の粒度は updateVideo の section と整合:
 *   - video.basics / video.credits / video.descriptions / video.members / video.youtube_id
 */

export interface VideoCollabPermSubject {
  x_user_id: string | null;
  discord_user_id: string | null;
  display_name: string;
  permission_keys: string[];
}

interface VideoCollabPermsManagerProps {
  videoId: string;
  subjects: VideoCollabPermSubject[];
}

const PERMISSION_OPTIONS: { key: string; label: string; description: string }[] = [
  {
    key: "video.basics",
    label: "基本情報",
    description: "タイトル等の基本フィールドを編集できます。",
  },
  {
    key: "video.credits",
    label: "楽曲・クレジット",
    description: "楽曲名・クレジット・楽曲リンクを編集できます。",
  },
  {
    key: "video.descriptions",
    label: "紹介文",
    description: "紹介コメント・みどころ・制作エピソード等を編集できます。",
  },
  {
    key: "video.members",
    label: "合作メンバー",
    description: "メンバー一覧の追加・編集・並び替えができます。",
  },
  {
    key: "video.youtube_id",
    label: "YouTube ID",
    description: "YouTube 動画 ID を変更できます (重複登録に注意)。",
  },
];

function subjectKey(s: VideoCollabPermSubject): string {
  return s.x_user_id ? `x:${s.x_user_id}` : `d:${s.discord_user_id}`;
}

export function VideoCollabPermsManager({
  videoId,
  subjects,
}: VideoCollabPermsManagerProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // 削除確認ダイアログの対象
  const [confirmDelete, setConfirmDelete] =
    React.useState<VideoCollabPermSubject | null>(null);

  const submitUpsert = (
    subject: VideoCollabPermSubject | null,
    keys: string[],
    options: { xUserId?: string; discordUserId?: string; displayName: string },
  ) => {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    if (options.xUserId) fd.set("x_user_id", options.xUserId);
    if (options.discordUserId) fd.set("discord_user_id", options.discordUserId);
    fd.set("display_name", options.displayName);
    fd.set("permission_keys", keys.join(","));
    startTransition(async () => {
      const r = await upsertVideoCollaboratorPermissions(fd);
      if (!r.ok) {
        setError(r.message ?? "更新に失敗しました。");
        return;
      }
      setMessage(r.message ?? "更新しました。");
      router.refresh();
    });
  };

  const submitDelete = (subject: VideoCollabPermSubject) => {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    if (subject.x_user_id) fd.set("x_user_id", subject.x_user_id);
    if (subject.discord_user_id) fd.set("discord_user_id", subject.discord_user_id);
    startTransition(async () => {
      const r = await deleteVideoCollaboratorPermissions(fd);
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
        合作メンバーに作品の編集権限を付与します。X ID 未連携のメンバーにも先付与でき、
        後で Discord 連携されたタイミングで自動的に有効化されます。
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
            gap: 10,
          }}
        >
          {subjects.map((s) => (
            <SubjectRow
              key={subjectKey(s)}
              subject={s}
              pending={pending}
              onSave={(keys) =>
                submitUpsert(s, keys, {
                  xUserId: s.x_user_id ?? undefined,
                  discordUserId: s.discord_user_id ?? undefined,
                  displayName: s.display_name,
                })
              }
              onDelete={() => setConfirmDelete(s)}
            />
          ))}
        </ul>
      )}

      <AddSubjectForm
        pending={pending}
        onAdd={(name, xUserId, keys) =>
          submitUpsert(null, keys, {
            xUserId: xUserId || undefined,
            displayName: name,
          })
        }
      />

      {message ? (
        <p className="fn-text-sm" style={{ color: "var(--text-secondary)", margin: 0 }}>
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
            ? `${confirmDelete.display_name} (${confirmDelete.x_user_id ? `@${confirmDelete.x_user_id}` : `discord:${confirmDelete.discord_user_id}`}) の編集権限をすべて解除します。`
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

function SubjectRow({
  subject,
  pending,
  onSave,
  onDelete,
}: {
  subject: VideoCollabPermSubject;
  pending: boolean;
  onSave: (keys: string[]) => void;
  onDelete: () => void;
}): React.ReactElement {
  const [keys, setKeys] = React.useState<string[]>(subject.permission_keys);
  const dirty = React.useMemo(() => {
    const a = [...keys].sort();
    const b = [...subject.permission_keys].sort();
    return a.length !== b.length || a.some((k, i) => k !== b[i]);
  }, [keys, subject.permission_keys]);

  return (
    <li
      style={{
        padding: 12,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-surface)",
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "baseline",
        }}
      >
        <div>
          <strong>{subject.display_name}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)" }}>
            {subject.x_user_id
              ? `@${subject.x_user_id}`
              : subject.discord_user_id
                ? `discord:${subject.discord_user_id.slice(0, 12)}…`
                : "(subject 未設定)"}
          </span>
        </div>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending}
          onClick={onDelete}
        >
          <Icon name="trash" size={11} aria-hidden /> 解除
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 6,
        }}
      >
        {PERMISSION_OPTIONS.map((opt) => {
          const checked = keys.includes(opt.key);
          return (
            <label
              key={opt.key}
              title={opt.description}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12,
                cursor: pending ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={pending}
                onChange={(e) => {
                  setKeys((prev) =>
                    e.target.checked
                      ? Array.from(new Set([...prev, opt.key]))
                      : prev.filter((k) => k !== opt.key),
                  );
                }}
              />
              {opt.label}
            </label>
          );
        })}
      </div>

      {dirty ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={pending}
            onClick={() => onSave(keys)}
          >
            <Icon name="check" size={11} aria-hidden /> 変更を保存
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={pending}
            onClick={() => setKeys(subject.permission_keys)}
          >
            取り消し
          </button>
        </div>
      ) : null}
    </li>
  );
}

function AddSubjectForm({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (displayName: string, xUserId: string, keys: string[]) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [xUserId, setXUserId] = React.useState("");
  const [keys, setKeys] = React.useState<string[]>([]);

  const canSubmit = name.trim().length > 0 && xUserId.trim().length > 0 && keys.length > 0;

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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 6,
        }}
      >
        {PERMISSION_OPTIONS.map((opt) => {
          const checked = keys.includes(opt.key);
          return (
            <label
              key={opt.key}
              title={opt.description}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setKeys((prev) =>
                    e.target.checked
                      ? Array.from(new Set([...prev, opt.key]))
                      : prev.filter((k) => k !== opt.key),
                  );
                }}
              />
              {opt.label}
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={pending || !canSubmit}
          onClick={() => {
            onAdd(name.trim(), xUserId.trim(), keys);
            setName("");
            setXUserId("");
            setKeys([]);
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
            setKeys([]);
          }}
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
