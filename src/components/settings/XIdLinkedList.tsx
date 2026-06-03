"use client";

import * as React from "react";
import Link from "next/link";
import pageStyles from "./settings-page.module.css";
import { SettingsStatusPill, type XApprovalStatus } from "./SettingsStatusPill";
import { Icon } from "@/components/ui/Icon";
import {
  DeleteXIdForm,
  SetActiveXButton,
  XIdCompactProfileForm,
} from "./XIdSettingsClient";
import { formatUnix } from "@/lib/utils/format";

export type SettingsXIdRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: XApprovalStatus;
  approval_requested_at: number | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
  other_social_links: string | null;
};

export type PendingLinkRequestRow = {
  id: string;
  requested_x_id: string;
  requested_at: number;
};

function XIdAvatar({
  id,
  iconUrl,
  small,
}: {
  id: string;
  iconUrl: string | null;
  small?: boolean;
}): React.ReactElement {
  const letter = id.charAt(0).toUpperCase();
  const className = `${pageStyles.avatar} ${small ? pageStyles.avatarSm : ""}`;

  if (iconUrl) {
    return (
      <span className={className} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" className={pageStyles.avatarImg} />
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {letter}
    </span>
  );
}

function linkedLabel(unix: number | null): string {
  if (!unix) return "— 連携";
  return `${formatUnix(unix, { dateOnly: true })} 連携`;
}

export function XIdLinkedList({
  xIds,
  activeXUserId,
  iconCandidatesById,
  next,
}: {
  xIds: SettingsXIdRow[];
  activeXUserId: string | null;
  iconCandidatesById: Record<string, string[]>;
  next?: string | null;
}): React.ReactElement {
  const sorted = React.useMemo(() => {
    const order = (s: XApprovalStatus) =>
      s === "approved" ? 0 : s === "pending" ? 1 : 2;
    return [...xIds].sort((a, b) => {
      if (a.id === activeXUserId) return -1;
      if (b.id === activeXUserId) return 1;
      return order(a.approval_status) - order(b.approval_status);
    });
  }, [xIds, activeXUserId]);

  const defaultEdit =
    activeXUserId &&
    xIds.some((x) => x.id === activeXUserId && x.approval_status === "approved")
      ? activeXUserId
      : null;

  const [editingId, setEditingId] = React.useState<string | null>(
    defaultEdit,
  );

  React.useEffect(() => {
    if (editingId && !xIds.some((x) => x.id === editingId)) {
      setEditingId(defaultEdit);
    }
  }, [xIds, editingId, defaultEdit]);

  if (sorted.length === 0) {
    return (
      <p className={pageStyles.emptyList}>
        承認済みの X ID はまだありません。下のフォームから連携を申請するか、運営の承認をお待ちください。
      </p>
    );
  }

  return (
    <ul className={pageStyles.list}>
      {sorted.map((x) => {
        const isActive = x.id === activeXUserId;
        const isEditing = editingId === x.id;
        const approved = x.approval_status === "approved";

        return (
          <li
            key={x.id}
            className={
              pageStyles.row +
              (isActive ? ` ${pageStyles.rowActive}` : "") +
              (isEditing ? ` ${pageStyles.rowEditing}` : "")
            }
          >
            <div className={pageStyles.rowHead}>
              <XIdAvatar id={x.id} iconUrl={x.icon_url} small />
              <div className={pageStyles.rowInfo}>
                <span className={pageStyles.rowName}>{x.x_name || x.id}</span>
                <span className={pageStyles.rowHandle}>
                  <Icon name="x" size={11} aria-hidden />@{x.id}
                </span>
                <span className={pageStyles.rowDate}>
                  {linkedLabel(x.approval_requested_at)}
                </span>
              </div>
              <div className={pageStyles.rowBadges}>
                <SettingsStatusPill status={x.approval_status} />
                {isActive && approved ? (
                  <span className="fn-badge fn-badge-accent">★ アクティブ</span>
                ) : null}
              </div>
              <div className={pageStyles.rowOps}>
                {approved && !isActive ? (
                  <SetActiveXButton
                    xUserId={x.id}
                    next={next}
                    label="アクティブに設定"
                    className={pageStyles.linkBtn}
                  />
                ) : null}
                {approved && !isEditing ? (
                  <button
                    type="button"
                    className={pageStyles.linkBtn}
                    onClick={() => setEditingId(x.id)}
                  >
                    プロフィール編集
                  </button>
                ) : null}
                {x.approval_status === "rejected" ? (
                  <span
                    className={`${pageStyles.linkBtn} ${pageStyles.linkBtnMuted}`}
                    title="却下された X ID の再審査は運営が行います。"
                  >
                    再申請
                  </span>
                ) : null}
                {!isActive ? (
                  <DeleteXIdForm
                    xUserId={x.id}
                    label="削除"
                    className={`${pageStyles.linkBtn} ${pageStyles.linkBtnDanger}`}
                  />
                ) : null}
              </div>
            </div>

            {isEditing && approved ? (
              <div className={pageStyles.editPanel}>
                <p className={pageStyles.editTitle}>プロフィール編集</p>
                <XIdCompactProfileForm
                  x={x}
                  iconCandidates={iconCandidatesById[x.id] ?? []}
                  onCancel={() => setEditingId(null)}
                />
                <details className={pageStyles.moreProfile}>
                  <summary
                    className={`${pageStyles.linkBtn} ${pageStyles.moreProfileSummary}`}
                  >
                    その他のプロフィール項目
                  </summary>
                  <p className={pageStyles.moreProfileNote}>
                    概要・YouTube・SNS などは{" "}
                    <Link href={`/user/${x.id}`}>公開プロフィール</Link>
                    から編集できます（今後この画面に統合予定）。
                  </p>
                </details>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function PendingLinkRequestList({
  rows,
}: {
  rows: PendingLinkRequestRow[];
}): React.ReactElement | null {
  if (rows.length === 0) return null;

  return (
    <ul className={`${pageStyles.list} ${pageStyles.listTight}`}>
      {rows.map((r) => (
        <li key={r.id} className={pageStyles.row}>
          <div className={pageStyles.rowHead}>
            <span
              className={`${pageStyles.avatar} ${pageStyles.avatarSm} ${pageStyles.avatarPending}`}
              aria-hidden="true"
            >
              ?
            </span>
            <div className={pageStyles.rowInfo}>
              <span className={pageStyles.rowName}>@{r.requested_x_id}</span>
              <span className={pageStyles.rowDate}>
                {formatUnix(r.requested_at, { dateOnly: true })}{" "}
                {formatUnix(r.requested_at, { timeOnly: true })} 申請
              </span>
            </div>
            <div className={pageStyles.rowBadges}>
              <SettingsStatusPill status="pending" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
