"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { approveXIdLinkRequest, rejectXIdLinkRequest } from "@/lib/actions/xid-admin";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";
import { ManageXIcon } from "@/components/manage/ManageXIcon";

export interface XLinkRequestRow {
  id: string;
  requested_x_id: string;
  requested_by_auth_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_at: number;
  request_type: "new_link" | "existing_link" | "alias" | "merge" | "revert_merge";
  target_x_user_id?: string | null;
  requested_x_name?: string | null;
  requested_icon_url?: string | null;
  requested_approval_status?: string | null;
  target_icon_url?: string | null;
  target_approval_status?: string | null;
}

function xUrl(xId: string): string {
  return `https://x.com/${encodeURIComponent(xId)}`;
}

function flameNodeUserUrl(xId: string): string {
  return `/user/${encodeURIComponent(xId)}`;
}

function requestTypeLabel(type: XLinkRequestRow["request_type"]): string {
  if (type === "new_link" || type === "existing_link") return "X ID連携";
  if (type === "alias") return "旧別名申請";
  if (type === "merge") return "X ID統合";
  return "統合取消";
}

function XIdPreview({
  xId,
  name,
  iconUrl,
  compact = false,
}: {
  xId: string;
  name?: string | null;
  iconUrl?: string | null;
  compact?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 10,
        minWidth: 0,
      }}
    >
      <ManageXIcon
        iconUrl={iconUrl}
        label={name ?? xId}
        size={compact ? 24 : 36}
        className="x-link-request-avatar"
        fallbackClassName="x-link-request-avatar-fallback"
        style={{
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-elevated)",
          flexShrink: 0,
        }}
      />
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: "block" }}>
          {name ? `${name} ` : ""}@{xId}
        </strong>
        <span
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 3,
            fontSize: 11,
          }}
        >
          <a href={xUrl(xId)} target="_blank" rel="noreferrer">
            Xで確認
          </a>
          <a href={flameNodeUserUrl(xId)} target="_blank" rel="noreferrer">
            FlameNode
          </a>
        </span>
      </span>
    </div>
  );
}

export function XLinkRequestTable({
  rows,
}: {
  rows: XLinkRequestRow[];
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState<string>("");

  const run = (
    fn: (fd: FormData) => Promise<{ ok: boolean; message?: string }>,
    requestId: string,
    reason?: string,
  ) => {
    setMsg(null);
    const fd = new FormData();
    fd.set("request_id", requestId);
    if (reason) fd.set("reason", reason);
    startTransition(async () => {
      try {
        const r = await fn(fd);
        setMsg(r.message ?? (r.ok ? "処理しました。" : "処理に失敗しました。"));
        if (r.ok) {
          setRejectingId(null);
          setRejectReason("");
          router.refresh();
        }
      } catch {
        setMsg("通信または処理中に問題が発生しました。再読み込みしてお試しください。");
      }
    });
  };

  if (rows.length === 0) {
    return (
      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        承認待ちの X ID 連携申請はありません。
      </p>
    );
  }

  return (
    <div>
      {msg ? (
        <p
          role="status"
          style={{
            marginBottom: 12,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          {msg}
        </p>
      ) : null}
      <table className="fn-table approval-queue-table approval-queue-table-xid">
        <thead>
          <tr>
            <th>申請 ID</th>
            <th>X ID</th>
            <th>種別</th>
            <th>申請者</th>
            <th>申請日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.id}</td>
              <td>
                <XIdPreview
                  xId={r.requested_x_id}
                  name={r.requested_x_name}
                  iconUrl={r.requested_icon_url}
                />
              </td>
              <td>
                <span
                  className={`fn-badge ${
                    r.request_type === "merge"
                      ? "fn-badge-danger"
                      : r.request_type === "alias"
                        ? "fn-badge-warning"
                        : "fn-badge-soft"
                  }`}
                >
                  {requestTypeLabel(r.request_type)}
                </span>
                {r.target_x_user_id ? (
                  <div style={{ marginTop: 8 }}>
                    <XIdPreview
                      xId={r.target_x_user_id}
                      iconUrl={r.target_icon_url}
                      compact
                    />
                  </div>
                ) : null}
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {r.discord_image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={r.discord_image}
                      alt=""
                      width={32}
                      height={32}
                      style={{ borderRadius: 999, objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        background: "var(--bg-elevated)",
                        color: "var(--text-muted)",
                      }}
                    >
                      <Icon name="discord" size={14} aria-hidden />
                    </span>
                  )}
                  <span>
                    <strong>{r.discord_name ?? "Discord user"}</strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      {r.requested_by_auth_user_id}
                    </span>
                  </span>
                </div>
              </td>
              <td style={{ fontSize: 12 }}>
                {formatUnix(r.requested_at, { dateOnly: true })}{" "}
                {formatUnix(r.requested_at, { timeOnly: true })}
              </td>
              <td>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fn-btn fn-btn-primary fn-btn-sm"
                    disabled={pending}
                    onClick={() => run(approveXIdLinkRequest, r.id)}
                  >
                    承認
                  </button>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={pending}
                    onClick={() => {
                      setRejectingId((cur) => (cur === r.id ? null : r.id));
                      setRejectReason("");
                    }}
                  >
                    却下
                  </button>
                </div>
                {rejectingId === r.id ? (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      maxWidth: 280,
                    }}
                  >
                    <textarea
                      className="fn-input"
                      placeholder="却下理由 (任意・履歴に残る)"
                      rows={2}
                      maxLength={500}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="fn-btn fn-btn-danger fn-btn-sm"
                        disabled={pending}
                        onClick={() => run(rejectXIdLinkRequest, r.id, rejectReason.trim())}
                      >
                        理由を添えて却下
                      </button>
                      <button
                        type="button"
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectReason("");
                        }}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
