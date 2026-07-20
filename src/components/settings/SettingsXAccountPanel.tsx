"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import pageStyles from "./settings-page.module.css";
import { SettingsStatusPill } from "./SettingsStatusPill";
import {
  DeleteXIdForm,
  SetActiveXButton,
  XIdCompactProfileForm,
} from "./XIdSettingsClient";
import type { SettingsXIdRow } from "./XIdLinkedList";
import { publicPageLinkProps, publicUserHref } from "./settingsPublicLink";

function linkedLabel(unix: number | null): string {
  if (!unix) return "連携日未記録";
  return `${formatUnix(unix, { dateOnly: true })} 連携`;
}

export function SettingsXAccountPanel({
  x,
  isActive,
  iconCandidates,
  channelCandidates,
  next,
}: {
  x: SettingsXIdRow;
  isActive: boolean;
  iconCandidates: string[];
  channelCandidates: string[];
  next?: string | null;
}): React.ReactElement {
  const approved = x.approval_status === "approved";
  const publicHref = approved ? publicUserHref(x.id) : null;

  return (
    <div className={pageStyles.accountPanel}>
      <div className={pageStyles.activePanel}>
        {x.icon_url ? (
          <span className={pageStyles.avatar} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.icon_url} alt="" className={pageStyles.avatarImg} />
          </span>
        ) : (
          <span className={pageStyles.avatar} aria-hidden="true">
            {x.id.charAt(0).toUpperCase()}
          </span>
        )}
        <div className={pageStyles.activeId}>
          {publicHref ? (
            <Link
              href={publicHref}
              className={pageStyles.activeNameLink}
              {...publicPageLinkProps}
            >
              {x.x_name || x.id}
            </Link>
          ) : (
            <span className={pageStyles.activeName}>{x.x_name || x.id}</span>
          )}
          <span className={pageStyles.activeHandle}>
            <Icon name="x" size={11} aria-hidden />@{x.id}
          </span>
          <span className={pageStyles.rowDate}>{linkedLabel(x.requested_at)}</span>
        </div>
        <div className={pageStyles.activeBadges}>
          <SettingsStatusPill status={x.approval_status} />
          {isActive && approved ? (
            <span className="fn-badge fn-badge-accent">アクティブ</span>
          ) : null}
        </div>
      </div>

      <div className={pageStyles.accountActions}>
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
        {publicHref ? (
          <Link
            href={publicHref}
            className={pageStyles.actionBtn}
            {...publicPageLinkProps}
          >
            <Icon name="user" size={12} aria-hidden />
            公開ページ
          </Link>
        ) : null}
        {!isActive ? (
          <DeleteXIdForm
            xUserId={x.id}
            label="連携を解除"
            className={`${pageStyles.actionBtn} ${pageStyles.actionBtnDanger}`}
          />
        ) : null}
        {x.approval_status === "rejected" ? (
          <span
            className={`${pageStyles.actionBtn} ${pageStyles.actionBtnMuted}`}
            title="却下された X ID の再審査は運営が行います。"
          >
            再申請待ち
          </span>
        ) : null}
      </div>

      {approved ? (
        <div className={pageStyles.editPanel}>
          <p className={pageStyles.editTitle}>公開プロフィール</p>
          <XIdCompactProfileForm
            x={x}
            iconCandidates={iconCandidates}
            channelCandidates={channelCandidates}
          />
        </div>
      ) : x.approval_status === "pending" ? (
        <p className={pageStyles.accountNote}>
          運営の承認後、この X ID をアクティブに設定して投稿できます。
        </p>
      ) : (
        <p className={pageStyles.accountNote}>
          却下された X ID です。再審査が必要な場合は運営にお問い合わせください。
        </p>
      )}
    </div>
  );
}
