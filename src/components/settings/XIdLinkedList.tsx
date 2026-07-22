"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { cancelXIdLinkRequest } from "@/lib/actions/xid";
import { formatUnix } from "@/lib/utils/format";
import type {
  XIdentityRequestStatus,
  XIdentityRequestType,
} from "@/lib/auth/xIdentityRequestCore";
import pageStyles from "./settings-page.module.css";
import type { XApprovalStatus } from "./SettingsStatusPill";

export type SettingsXIdRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: XApprovalStatus;
  requested_at: number | null;
  profile_text: string | null;
  portfolio_contact: string | null;
  youtube_channel_url: string | null;
  other_social_links: string | null;
};

export type XIdentityRequestHistoryRow = {
  id: string;
  request_type: XIdentityRequestType;
  requested_x_id: string | null;
  source_x_user_id: string | null;
  target_x_user_id: string | null;
  status: XIdentityRequestStatus;
  requested_at: number;
  updated_at: number;
};

const REQUEST_TYPE_LABELS: Record<XIdentityRequestType, string> = {
  new_link: "X ID連携",
  existing_link: "X ID連携",
  alias: "旧別名申請",
  merge: "X ID統合",
  revert_merge: "統合取消",
};

const STATUS_LABELS: Record<XIdentityRequestStatus, string> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  done: "完了",
  cancelled: "取消済み",
};

const WITHDRAWABLE_TYPES = new Set<XIdentityRequestType>([
  "new_link",
  "existing_link",
  "alias",
  "merge",
]);

function requestTarget(row: XIdentityRequestHistoryRow): string {
  if (row.request_type === "merge") {
    return row.source_x_user_id && row.target_x_user_id
      ? `@${row.source_x_user_id} → @${row.target_x_user_id}`
      : "X ID統合";
  }
  if (row.request_type === "alias") {
    return row.requested_x_id && row.target_x_user_id
      ? `@${row.requested_x_id} → @${row.target_x_user_id}`
      : row.requested_x_id
        ? `@${row.requested_x_id}`
        : "旧別名申請";
  }
  if (row.request_type === "revert_merge") return "統合取消申請";
  return row.requested_x_id ? `@${row.requested_x_id}` : "X ID連携";
}

function statusClass(status: XIdentityRequestStatus): string {
  if (status === "pending") return "fn-badge fn-badge-warning";
  if (status === "rejected" || status === "cancelled") {
    return "fn-badge fn-badge-danger";
  }
  return "fn-badge fn-badge-accent";
}

export function XIdentityRequestHistoryList({
  rows,
}: {
  rows: XIdentityRequestHistoryRow[];
}): React.ReactElement | null {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  if (rows.length === 0) return null;

  const withdraw = (requestId: string) => {
    if (!window.confirm("この申請を取り下げますか？")) return;
    setMessage(null);
    setPendingId(requestId);
    const fd = new FormData();
    fd.set("request_id", requestId);
    void (async () => {
      try {
        const result = await cancelXIdLinkRequest(fd);
        setMessage(result.message ?? (result.ok ? "申請を取り下げました。" : "取り下げに失敗しました。"));
        if (result.ok) router.refresh();
      } catch {
        setMessage("通信または処理中に問題が発生しました。再読み込みしてお試しください。");
      } finally {
        setPendingId(null);
      }
    })();
  };

  return (
    <div>
      {message ? (
        <p role="status" className={pageStyles.cardDesc} style={{ marginBottom: 12 }}>
          {message}
        </p>
      ) : null}
      <ul className={`${pageStyles.list} ${pageStyles.listTight}`}>
        {rows.map((row) => {
          const canWithdraw =
            row.status === "pending" && WITHDRAWABLE_TYPES.has(row.request_type);
          return (
            <li key={row.id} className={pageStyles.row}>
              <div className={pageStyles.rowHead}>
                <span
                  className={`${pageStyles.avatar} ${pageStyles.avatarSm} ${pageStyles.avatarPending}`}
                  aria-hidden="true"
                >
                  ?
                </span>
                <div className={pageStyles.rowInfo}>
                  <span className={pageStyles.rowName}>{requestTarget(row)}</span>
                  <span className={pageStyles.rowDate}>
                    {REQUEST_TYPE_LABELS[row.request_type]}・{" "}
                    {formatUnix(row.requested_at, { dateOnly: true })}{" "}
                    {formatUnix(row.requested_at, { timeOnly: true })} 申請
                    {row.status !== "pending" && row.updated_at !== row.requested_at
                      ? `・最終更新 ${formatUnix(row.updated_at, { dateOnly: true })} ${formatUnix(row.updated_at, { timeOnly: true })}`
                      : ""}
                  </span>
                </div>
                <div className={pageStyles.rowBadges}>
                  <span className={statusClass(row.status)}>
                    {STATUS_LABELS[row.status]}
                  </span>
                </div>
              </div>
              {canWithdraw ? (
                <div className={pageStyles.rowOps}>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={pendingId !== null}
                    aria-busy={pendingId === row.id}
                    onClick={() => withdraw(row.id)}
                  >
                    {pendingId === row.id ? "取下げ中…" : "取り下げる"}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
