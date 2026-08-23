"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  applyVideoCollaboratorPermissionsBatch,
  upsertVideoCollaborator,
} from "@/lib/actions/video-collab-perms";
import { buildVideoEditPermissionGrantedNotification } from "@/lib/notifications/templates/video";
import styles from "./VideoCollabPermsManager.module.css";

/**
 * 作品の「編集できる人」(video_members.can_edit) を管理する UI。
 * 公開メンバー (is_public_member=1) とは画面で役割を分け、内部テーブルは共通。
 * 実際の所有者判定は can_edit=1 に加えて、認証ユーザーと承認済み X ID の
 * x_user_account_links が必要。未連携状態は「権限付与済み」として区別する。
 */

export interface VideoCollabSubject {
  x_user_id: string | null;
  user_id: string | null;
  display_name: string;
  can_edit: number;
  is_public_member: number;
  /** x_user_account_links に認証ユーザー紐付けがある */
  has_discord_link?: boolean;
}

export interface VideoPublicMemberCandidate {
  x_user_id: string | null;
  display_name: string;
  role: string | null;
  can_edit: number;
}

interface Props {
  videoId: string;
  videoTitle: string;
  subjects: VideoCollabSubject[];
  publicMembers?: VideoPublicMemberCandidate[];
  /** Server Action が再検証する privilegeMode。URL の ?privileged= と一致させる。 */
  editPrivilegeMode?: "normal" | "admin" | "event";
}

type GrantDialogState = {
  subject: VideoCollabSubject | NewSubjectDraft;
  displayName: string;
};

type NewSubjectDraft = {
  x_user_id: string;
  user_id?: string | null;
  display_name: string;
};

type RevokeDialogState = {
  subject: VideoCollabSubject;
};

function subjectKey(s: Pick<VideoCollabSubject, "x_user_id" | "user_id">): string {
  return s.x_user_id ? `x:${s.x_user_id}` : `u:${s.user_id ?? ""}`;
}

function hasResolvableSubject(s: {
  x_user_id?: string | null;
}): boolean {
  // 共同編集所有者の正本は X ID。Discord Snowflake / Auth.js内部IDを
  // UIから直接指定する経路は作らず、X ID連携後に認証ユーザーへ解決する。
  return Boolean(s.x_user_id?.trim());
}

function hasAccountLink(subject: VideoCollabSubject): boolean {
  return Boolean(subject.user_id?.trim() || subject.has_discord_link);
}

/** 一覧行は最大2バッジまで */
function CompactEditorBadges({
  subject,
}: {
  subject: VideoCollabSubject;
}): React.ReactElement {
  const linked = hasAccountLink(subject);
  const hasX = Boolean(subject.x_user_id?.trim());
  return (
    <div className={styles.badges}>
      <span className={`${styles.badge} ${linked ? styles.badgeOk : styles.badgeWarn}`}>
        {linked ? "編集可能" : "権限付与済み"}
      </span>
      {!linked && hasX ? (
        <span className={`${styles.badge} ${styles.badgeWarn}`}>X ID連携待ち</span>
      ) : null}
    </div>
  );
}

function SubjectBadges({ subject }: { subject: VideoCollabSubject }): React.ReactElement {
  const isPublic = subject.is_public_member === 1;
  const linked = hasAccountLink(subject);
  const hasX = Boolean(subject.x_user_id?.trim());

  return (
    <div className={styles.badges}>
      {isPublic ? (
        <span className={`${styles.badge} ${styles.badgeAccent}`}>公開メンバー</span>
      ) : (
        <span className={`${styles.badge} ${styles.badgeWarn}`}>非公開編集者</span>
      )}
      <span className={`${styles.badge} ${linked ? styles.badgeOk : styles.badgeWarn}`}>
        {linked ? "編集可能" : "権限付与済み"}
      </span>
      {linked ? (
        <span className={`${styles.badge} ${styles.badgeOk}`}>アカウント連携済み</span>
      ) : hasX ? (
        <span className={`${styles.badge} ${styles.badgeWarn}`}>X ID連携待ち</span>
      ) : (
        <span className={styles.badge}>X ID未設定</span>
      )}
    </div>
  );
}

function PermissionDialog({
  open,
  title,
  message,
  note,
  preview,
  actions,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  note?: React.ReactNode;
  preview?: string;
  actions: { label: string; variant: "primary" | "ghost" | "danger"; onClick: () => void }[];
  onCancel: () => void;
}): React.ReactElement | null {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="collab-dialog-title"
      >
        <div className={styles.dialogBody}>
          <p id="collab-dialog-title" className={styles.dialogTitle}>
            {title}
          </p>
          <p className={styles.dialogMessage}>{message}</p>
          {note ? (
            <div className={styles.dialogNote}>{note}</div>
          ) : null}
          {preview ? <div className={styles.previewBox}>{preview}</div> : null}
        </div>
        <div className={styles.dialogFooter}>
          <button type="button" className="fn-btn fn-btn-ghost" onClick={onCancel}>
            キャンセル
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={
                action.variant === "danger"
                  ? "fn-btn fn-btn-danger"
                  : action.variant === "primary"
                    ? "fn-btn fn-btn-primary"
                    : "fn-btn fn-btn-ghost"
              }
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function VideoCollabPermsManager({
  videoId,
  videoTitle,
  subjects,
  publicMembers = [],
  editPrivilegeMode = "normal",
}: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [grantDialog, setGrantDialog] = React.useState<GrantDialogState | null>(null);
  const [revokeDialog, setRevokeDialog] = React.useState<RevokeDialogState | null>(null);

  const appendPrivilegeMode = (fd: FormData) => {
    if (editPrivilegeMode !== "normal") {
      fd.set("edit_privilege_mode", editPrivilegeMode);
    }
  };

  const editors = subjects.filter((s) => s.can_edit === 1);
  const publicEditors = editors.filter((s) => s.is_public_member === 1);
  const hiddenEditors = editors.filter((s) => s.is_public_member === 0);
  const unlinkedEditors = editors.filter((s) => !hasAccountLink(s));
  const grantCandidates = publicMembers.filter((p) => {
    if (p.can_edit === 1) return false;
    if (!p.x_user_id?.trim() && !p.display_name.trim()) return false;
    const already = subjects.some(
      (s) =>
        s.can_edit === 1 &&
        p.x_user_id &&
        s.x_user_id &&
        p.x_user_id.toLowerCase() === s.x_user_id.toLowerCase(),
    );
    return !already;
  });

  const submitUpsert = (
    draft: VideoCollabSubject | NewSubjectDraft,
    options: { notify: boolean },
  ) => {
    if (!hasResolvableSubject(draft)) {
      setError("編集権を付与するには X ID が必要です。メンバーの X ID を設定してください。");
      return;
    }
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("video_id", videoId);
    if (draft.x_user_id) fd.set("x_user_id", draft.x_user_id);
    fd.set("display_name", draft.display_name);
    fd.set("can_edit", "1");
    fd.set("notify", options.notify ? "1" : "0");
    appendPrivilegeMode(fd);
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

  const submitRevoke = (subject: VideoCollabSubject) => {
    const xUserId = subject.x_user_id?.trim();
    if (!xUserId) {
      setError("編集権限を解除するには X ID が必要です。");
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const r = await applyVideoCollaboratorPermissionsBatch({
        video_id: videoId,
        ...(editPrivilegeMode !== "normal"
          ? { edit_privilege_mode: editPrivilegeMode }
          : {}),
        notify: false,
        intents: [
          {
            x_user_id: xUserId,
            display_name: subject.display_name || `@${xUserId}`,
            intent: "off",
          },
        ],
      });
      if (!r.ok) {
        setError(r.message ?? "解除に失敗しました。");
        return;
      }
      setMessage(r.message ?? "解除しました。");
      router.refresh();
    });
  };

  const openGrantDialog = (
    subject: VideoCollabSubject | NewSubjectDraft,
    displayName: string,
  ) => {
    if (!hasResolvableSubject(subject)) {
      setError("編集権を付与するには X ID が必要です。メンバーの X ID を設定してください。");
      return;
    }
    setGrantDialog({ subject, displayName });
  };

  const notificationPreview = (_displayName: string) =>
    buildVideoEditPermissionGrantedNotification({
      videoId,
      videoTitle,
    }).content;

  const renderEditorRow = (s: VideoCollabSubject) => {
    const linked = hasAccountLink(s);
    return (
      <li key={subjectKey(s)} className={styles.row}>
        <div className={styles.rowHead}>
          <div className={styles.rowIdentity}>
            <strong>{s.display_name}</strong>
            <div className={styles.rowSub}>
              {s.x_user_id ? `@${s.x_user_id}` : "(X ID未設定)"}
            </div>
            <p className={styles.rowStatus}>
              {linked
                ? "編集できます"
                : "権限は付与済みです。X IDをログインアカウントへ連携すると編集できます。"}
            </p>
          </div>
          <CompactEditorBadges subject={s} />
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={pending}
            onClick={() => setRevokeDialog({ subject: s })}
          >
            変更
          </button>
        </div>
      </li>
    );
  };

  return (
    <div id="video-collab-perms" className={styles.root}>
      <p className={styles.intro}>
        共同編集権限（can_edit）は X ID に付与します。その X ID がログインアカウントへ承認済み連携されると、
        作品所有者として一般作品権限の範囲で実際に編集できます。未連携でも権限を先に付与できますが、
        連携完了までは編集できません。付与・解除は作者所有者、または video.permissions を持つ運営・管理者のみ可能です。
        合作所有者は他者へ再委譲できません。提出主体・YouTube ID・公開状態などは通常モードでは編集できず、
        管理者またはイベント運営権限が必要です。
      </p>

      {unlinkedEditors.length > 0 ? (
        <div role="status" className={styles.calloutWarn}>
          <strong>X ID連携待ちの編集者が {unlinkedEditors.length} 人います</strong>
          <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.55 }}>
            権限自体は保存済みです。対象の X ID とログインアカウントの連携が承認されると編集できるようになります。
          </p>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="collab-editors-heading">
        <h3 id="collab-editors-heading" className={styles.sectionTitle}>
          現在編集できる人
        </h3>
        {editors.length === 0 ? (
          <p className={styles.sectionHint}>まだ作品編集に参加できる人はいません。</p>
        ) : publicEditors.length > 0 ? (
          <ul className={styles.rowList}>{publicEditors.map(renderEditorRow)}</ul>
        ) : (
          <p className={styles.sectionHint}>
            公開メンバーとして権限が付与された人はいません。非公開編集者のみの場合は下のセクションを確認してください。
          </p>
        )}
      </section>

      {hiddenEditors.length > 0 ? (
        <section className={styles.section} aria-labelledby="collab-hidden-heading">
          <h3 id="collab-hidden-heading" className={styles.sectionTitle}>
            非公開編集者
          </h3>
          <p className={styles.sectionHint}>
            作品ページには表示されません。公開メンバー欄から削除する操作とは別です。
          </p>
          <ul className={styles.rowList}>{hiddenEditors.map(renderEditorRow)}</ul>
        </section>
      ) : null}

      {grantCandidates.length > 0 ? (
        <section className={styles.section} aria-labelledby="collab-from-public-heading">
          <h3 id="collab-from-public-heading" className={styles.sectionTitle}>
            公開メンバー
          </h3>
          <p className={styles.sectionHint}>
            メンバー欄に載っているが、まだ編集権がない人です。
          </p>
          <ul className={styles.candidateList}>
            {grantCandidates.map((p) => {
              const label = p.x_user_id
                ? `${p.display_name} @${p.x_user_id}`
                : `${p.display_name}（X ID未設定）`;
              const canGrant = Boolean(p.x_user_id?.trim());
              return (
                <li key={`pub-${p.x_user_id ?? p.display_name}`}>
                  <button
                    type="button"
                    className={styles.candidateBtn}
                    disabled={pending || !canGrant}
                    title={
                      canGrant
                        ? undefined
                        : "編集権を付与するには X ID が必要です。メンバー欄で X ID を設定してください。"
                    }
                    onClick={() =>
                      openGrantDialog(
                        {
                          x_user_id: p.x_user_id ?? "",
                          display_name: p.display_name,
                          user_id: null,
                          can_edit: 0,
                          is_public_member: 1,
                        },
                        p.display_name,
                      )
                    }
                  >
                    {label}
                    {p.role ? (
                      <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                        · {p.role}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <AddHiddenEditorForm
        pending={pending}
        onAdd={(draft) => openGrantDialog(draft, draft.display_name)}
      />

      {message ? (
        <p className={styles.feedbackOk}>
          <Icon name="check" size={12} aria-hidden /> {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.feedbackErr} role="alert">
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}

      <PermissionDialog
        open={!!grantDialog}
        title="作品編集に参加させますか？"
        message={
          grantDialog
            ? `${grantDialog.displayName} さんの X ID に、作品「${videoTitle}」の編集権限を付与します。X IDがログインアカウントに連携済みなら、許可された範囲で直ちに作品情報を編集できます。`
            : ""
        }
        note="未連携の X ID にも権限は保存できます。その場合はアカウント連携の承認後に編集可能になります。提出主体・YouTube ID・公開状態などの重要項目は、管理者またはイベント権限が必要です。"
        preview={
          grantDialog ? notificationPreview(grantDialog.displayName) : undefined
        }
        actions={[
          {
            label: "付与して通知する",
            variant: "primary",
            onClick: () => {
              const target = grantDialog;
              setGrantDialog(null);
              if (target) submitUpsert(target.subject, { notify: true });
            },
          },
          {
            label: "付与のみ",
            variant: "ghost",
            onClick: () => {
              const target = grantDialog;
              setGrantDialog(null);
              if (target) submitUpsert(target.subject, { notify: false });
            },
          },
        ]}
        onCancel={() => setGrantDialog(null)}
      />

      <PermissionDialog
        open={!!revokeDialog}
        title="編集権限を変更しますか？"
        message={
          revokeDialog
            ? `${revokeDialog.subject.display_name} さんの作品編集権限を解除します。`
            : ""
        }
        note={
          revokeDialog ? (
            <>
              {revokeDialog.subject.is_public_member === 1
                ? "公開メンバーとしての表示・役割・コメントは残ります。"
                : "非公開編集者のため、権限解除後にこの一覧から削除されます。"}
              <div style={{ marginTop: 10 }}>
                <SubjectBadges subject={revokeDialog.subject} />
              </div>
            </>
          ) : undefined
        }
        actions={[
          {
            label: "解除する",
            variant: "danger",
            onClick: () => {
              const target = revokeDialog?.subject;
              setRevokeDialog(null);
              if (target) submitRevoke(target);
            },
          },
        ]}
        onCancel={() => setRevokeDialog(null)}
      />
    </div>
  );
}

function AddHiddenEditorForm({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (draft: NewSubjectDraft) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [xUserId, setXUserId] = React.useState("");

  if (!open) {
    return (
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={() => setOpen(true)}
        disabled={pending}
        style={{ justifySelf: "flex-start" }}
      >
        <Icon name="plus" size={11} aria-hidden /> 非公開編集者を追加
      </button>
    );
  }

  const canSubmit = name.trim().length > 0 && xUserId.trim().length > 0;

  return (
    <div className={styles.addPanel}>
      <p className={styles.sectionHint} style={{ margin: 0 }}>
        公開メンバーとして表示したい場合は、上のメンバー欄に追加してください。ここは
        <strong> 表示されない編集者 </strong>
        向けです。編集権限は X ID に付与されます。
      </p>
      <div className={styles.fieldRow}>
        <input
          type="text"
          className="fn-input"
          placeholder="表示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <input
          type="text"
          className="fn-input"
          placeholder="X ID (@ なし・必須)"
          value={xUserId}
          onChange={(e) => setXUserId(e.target.value)}
          pattern="[A-Za-z0-9_]{1,32}"
          required
        />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={!canSubmit || pending}
          onClick={() => {
            onAdd({
              display_name: name.trim(),
              x_user_id: xUserId.trim(),
              user_id: null,
            });
            setName("");
            setXUserId("");
            setOpen(false);
          }}
        >
          確認へ進む
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
