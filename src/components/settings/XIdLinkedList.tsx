"use client";

import * as React from "react";

import { formatUnix } from "@/lib/utils/format";
import pageStyles from "./settings-page.module.css";
import { SettingsStatusPill, type XApprovalStatus } from "./SettingsStatusPill";


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
};export function PendingLinkRequestList({
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
