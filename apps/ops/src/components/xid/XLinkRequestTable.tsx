// Port of CURRENT src/components/admin/XLinkRequestTable.tsx (MIG-0732 U01 / D-17-6).
import * as React from "react";
import type { AdminXLinkRequestRow } from "@flamenode/contracts";
import type { XidLinkRequestsApi } from "../../api/xidLinkRequests.js";
import { ManageXIcon } from "../shared/ManageXIcon.js";
import { FnTable } from "../shared/FnTable.js";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

export function formatRequestTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}

function requestTypeLabel(type: string): string {
  if (type === "new_link" || type === "existing_link") return "X ID連携";
  if (type === "alias") return "旧別名申請";
  if (type === "merge") return "X ID統合";
  if (type === "revert_merge") return "統合取消";
  return type;
}

function XIdPreview({ xId, name, iconUrl, compact = false }: {
  xId: string; name?: string | null; iconUrl?: string | null; compact?: boolean;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 10 }}>
      <ManageXIcon iconUrl={iconUrl} label={name ?? xId} size={compact ? 24 : 36}
        className="x-link-request-avatar" fallbackClassName="x-link-request-avatar-fallback" />
      <span>
        <strong>{name ? name + " " : ""}@{xId}</strong>
        <span style={{ display: "flex", gap: 8, fontSize: 11 }}>
          <a href={"https://x.com/" + encodeURIComponent(xId)} target="_blank" rel="noreferrer">Xで確認</a>
          <a href={"/user/" + encodeURIComponent(xId)} target="_blank" rel="noreferrer">FlameNode</a>
        </span>
      </span>
    </div>
  );
}

export function XLinkRequestTable({ rows, api, onChanged }: {
  rows: AdminXLinkRequestRow[];
  api: XidLinkRequestsApi;
  onChanged: () => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");

  async function run(operation: "approve" | "reject", id: string): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = operation === "approve" ? await api.approve(id) : await api.reject(id, rejectReason);
      if (result.status === "anonymous") {
        window.location.assign("/entry");
        return;
      }
      if (result.status !== "ok") {
        setMessage("通信または処理中に問題が発生しました。再読み込みしてお試しください。");
        return;
      }
      setMessage(result.data.message ?? (result.data.ok ? "処理しました。" : "処理に失敗しました。"));
      if (result.data.ok) {
        setRejectingId(null);
        setRejectReason("");
        onChanged();
      }
    } catch {
      setMessage("通信または処理中に問題が発生しました。再読み込みしてお試しください。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (rows.length === 0) return <p className="fn-muted fn-text-sm">承認待ちの X ID 連携申請はありません。</p>;
  return <div>
    {message ? <p role="status" className="fn-muted fn-text-sm">{message}</p> : null}
    <FnTable className="approval-queue-table approval-queue-table-xid">
      <thead><tr>
        <th>申請 ID</th><th>X ID</th><th>種別</th><th>申請者</th><th>申請日時</th><th></th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td className="fn-text-sm">{row.id}</td>
        <td><XIdPreview xId={row.requested_x_id} name={row.requested_x_name} iconUrl={row.requested_icon_url} /></td>
        <td>
          <span className={"fn-badge " + (row.request_type === "merge" ? "fn-badge-danger" :
            row.request_type === "alias" ? "fn-badge-warning" : "fn-badge-soft")}>
            {requestTypeLabel(row.request_type)}
          </span>
          {row.target_x_user_id ? <div style={{ marginTop: 8 }}>
            <XIdPreview xId={row.target_x_user_id} iconUrl={row.target_icon_url} compact />
          </div> : null}
        </td>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {row.discord_image ? <img src={row.discord_image} alt="" width={32} height={32}
              style={{ borderRadius: 999, objectFit: "cover" }} /> : null}
            <span><strong>{row.discord_name ?? "Discord user"}</strong><br />
              <small>{row.requested_by_auth_user_id}</small></span>
          </div>
        </td>
        <td>{formatRequestTime(row.requested_at)}</td>
        <td>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="fn-btn fn-btn-primary fn-btn-sm" disabled={busy}
              onClick={() => { void run("approve", row.id); }}>承認</button>
            <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy}
              onClick={() => { setRejectingId(x => x === row.id ? null : row.id); setRejectReason(""); }}>却下</button>
          </div>
          {rejectingId === row.id ? <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <textarea className="fn-input" placeholder="却下理由 (任意・履歴に残る)" rows={2}
              maxLength={500} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy}
                onClick={() => { void run("reject", row.id); }}>理由を添えて却下</button>
              <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy}
                onClick={() => { setRejectingId(null); setRejectReason(""); }}>キャンセル</button>
            </div>
          </div> : null}
        </td>
      </tr>)}</tbody>
    </FnTable>
  </div>;
}
