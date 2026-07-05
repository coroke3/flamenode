"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import pageStyles from "./settings-page.module.css";
import { SettingsStatusPill, type XApprovalStatus } from "./SettingsStatusPill";
import {
  DeleteXIdForm,
  SetActiveXButton,
  XIdCompactProfileForm,
} from "./XIdSettingsClient";
import { publicPageLinkProps, publicUserHref } from "./settingsPublicLink";

export type SettingsXIdRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: XApprovalStatus;
  approval_requested_at: number | null;
  profile_text: string | null;
  portfolio_contact: string | null;
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
  href,
}: {
  id: string;
  iconUrl: string | null;
  small?: boolean;
  href?: string | null;
}): React.ReactElement {
  const letter = id.charAt(0).toUpperCase();
  const className = `${pageStyles.avatar} ${small ? pageStyles.avatarSm : ""}`;

  const inner = iconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={iconUrl} alt="" className={pageStyles.avatarImg} />
  ) : (
    letter
  );

  const avatar = (
    <span className={className} aria-hidden="true">
      {inner}
    </span>
  );

  if (!href) return avatar;

  return (
    <Link
      href={href}
      className={pageStyles.avatarLink}
      aria-label={`${id} の公開ページ`}
      {...publicPageLinkProps}
    >
      {avatar}
    </Link>
  );
}

function linkedLabel(unix: number | null): string {
  if (!unix) return "連携日未記録";
  return `${formatUnix(unix, { dateOnly: true })} 連携`;
}

export function XIdLinkedList({
  xIds,
  activeXUserId,
  iconCandidatesById,
  channelCandidatesById,
  next,
}: {
  xIds: SettingsXIdRow[];
  activeXUserId: string | null;
  iconCandidatesById: Record<string, string[]>;
  channelCandidatesById: Record<string, string[]>;
  next?: string | null;
}): React.ReactElement {
  const sorted = React.useMemo(() => {
    const order = (status: XApprovalStatus) =>
      status === "approved" ? 0 : status === "pending" ? 1 : 2;
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

  const [editingId, setEditingId] = React.useState<string | null>(defaultEdit);

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
        const publicHref = approved ? publicUserHref(x.id) : null;

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
              <XIdAvatar
                id={x.id}
                iconUrl={x.icon_url}
                small
                href={publicHref}
              />
              <div className={pageStyles.rowInfo}>
                {publicHref ? (
                  <Link
                    href={publicHref}
                    className={pageStyles.rowNameLink}
                    {...publicPageLinkProps}
                  >
                    {x.x_name || x.id}
                  </Link>
                ) : (
                  <span className={pageStyles.rowName}>{x.x_name || x.id}</span>
                )}
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
                  <span className="fn-badge fn-badge-accent">アクティブ</span>
                ) : null}
              </div>
              <div className={pageStyles.rowOps}>
                {isActive && approved ? (
                  <span className={pageStyles.activeMarker}>
                    <Icon name="check" size={12} aria-hidden />
                    投稿・枠確保で使用中
                  </span>
                ) : null}
                {approved && !isActive ? (
                  <SetActiveXButton
                    xUserId={x.id}
                    next={next}
                    label="アクティブに設定"
                    className={`${pageStyles.actionBtn} ${pageStyles.actionBtnPrimary}`}
                  />
                ) : null}
                {approved ? (
                  <Link
                    href={publicHref!}
                    className={pageStyles.actionBtn}
                    {...publicPageLinkProps}
                  >
                    <Icon name="user" size={12} aria-hidden />
                    公開ページ
                  </Link>
                ) : null}
                {approved ? (
                  <button
                    type="button"
                    className={pageStyles.actionBtn}
                    onClick={() => setEditingId(isEditing ? null : x.id)}
                  >
                    <Icon name="edit" size={12} aria-hidden />
                    {isEditing ? "編集を閉じる" : "公開プロフィール編集"}
                  </button>
                ) : null}
                {x.approval_status === "rejected" ? (
                  <span
                    className={`${pageStyles.actionBtn} ${pageStyles.actionBtnMuted}`}
                    title="却下された X ID の再審査は運営が行います。"
                  >
                    再申請待ち
                  </span>
                ) : null}
                {!isActive ? (
                  <DeleteXIdForm
                    xUserId={x.id}
                    label="削除"
                    className={`${pageStyles.actionBtn} ${pageStyles.actionBtnDanger}`}
                  />
                ) : null}
              </div>
            </div>

            {isEditing && approved ? (
              <div className={pageStyles.editPanel}>
                <p className={pageStyles.editTitle}>公開プロフィール編集</p>
                <XIdCompactProfileForm
                  key={x.id}
                  x={x}
                  iconCandidates={iconCandidatesById[x.id] ?? []}
                  channelCandidates={channelCandidatesById[x.id] ?? []}
                  onCancel={() => setEditingId(null)}
                />
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
      {rows.map((row) => (
        <li key={row.id} className={pageStyles.row}>
          <div className={pageStyles.rowHead}>
            <span
              className={`${pageStyles.avatar} ${pageStyles.avatarSm} ${pageStyles.avatarPending}`}
              aria-hidden="true"
            >
              ?
            </span>
            <div className={pageStyles.rowInfo}>
              <span className={pageStyles.rowName}>@{row.requested_x_id}</span>
              <span className={pageStyles.rowDate}>
                {formatUnix(row.requested_at, { dateOnly: true })}{" "}
                {formatUnix(row.requested_at, { timeOnly: true })} 申請
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
