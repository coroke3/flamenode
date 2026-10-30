/** MIG-0725 U03b: unmounted read-only X ID pending queue. Write actions await MIG-0605. */
import * as React from "react";
import type { ManageXLinkRequest, ManageXLinkRequestsResponse } from "@flamenode/contracts";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { readManageXLinkRequests } from "../../api/manageXLinkRequests.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { ManageXIcon } from "../../components/shared/ManageXIcon.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { NotFoundView } from "../NotFoundView.js";
import { AUTH_UNAVAILABLE } from "../guard.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";

const DEFAULT_FETCH: OpsFetch = (path, init) => fetch(path, init);
const fullDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

function formatRequestedAt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? fullDate.format(date) : "—";
}

function safeIconUrl(raw: string | null): string | null {
  if (!raw || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  // WHATWG treats "/\\evil.example" as an external network-path URL.
  // Check for both slash forms before passing any source to an <img>.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (!raw.startsWith("https://")) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password
      ? raw : null;
  } catch {
    return null;
  }
}

function XIdPreview({ id, name, icon, compact = false }: {
  id: string; name?: string | null; icon?: string | null; compact?: boolean;
}): React.ReactElement {
  const normalized = id.replace(/^@/, "");
  const safeIcon = safeIconUrl(icon ?? null);
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
    <ManageXIcon
      iconUrl={safeIcon} label={name ?? normalized} size={compact ? 24 : 36}
      className="x-link-request-avatar" fallbackClassName="x-link-request-avatar-fallback"
      style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", flexShrink: 0 }}
    />
    <span>
      <strong>{name ? name + " " : ""}@{normalized}</strong>
      <span style={{ display: "flex", gap: 8, fontSize: 11 }}>
        <a href={"https://x.com/" + encodeURIComponent(normalized)} target="_blank"
          rel="noopener noreferrer">Xで確認</a>
        <a href={"/user/" + encodeURIComponent(normalized)}>FlameNode</a>
      </span>
    </span>
  </span>;
}

function Row({ row }: { row: ManageXLinkRequest }): React.ReactElement {
  const type = row.request_type === "new_link" || row.request_type === "existing_link"
    ? "X ID連携" : row.request_type;
  const discordIcon = safeIconUrl(row.discord_image);
  return <tr>
    <td style={{ fontSize: 11, overflowWrap: "anywhere" }}>{row.id}</td>
    <td><XIdPreview id={row.requested_x_id} name={row.requested_x_name}
      icon={row.requested_icon_url} /></td>
    <td>
      <span className="fn-badge fn-badge-soft">{type}</span>
      {row.target_x_user_id ? <div style={{ marginTop: 8 }}>
        <XIdPreview id={row.target_x_user_id} icon={row.target_icon_url} compact />
      </div> : null}
    </td>
    <td><span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {discordIcon ? <img src={discordIcon} alt="" width={32} height={32}
        referrerPolicy="no-referrer" style={{ borderRadius: "50%", objectFit: "cover" }} /> : null}
      <span><strong>{row.discord_name ?? "Discord user"}</strong>
        <span style={{ display: "block", fontSize: 11, overflowWrap: "anywhere" }}>
          {row.requested_by_auth_user_id}
        </span>
      </span>
    </span></td>
    <td><time>{formatRequestedAt(row.requested_at)}</time></td>
  </tr>;
}

/** No approve/reject button until the Hono mutation contract is verified. */
export function ManageXLinkRequestsBody({ data }: { data: ManageXLinkRequestsResponse }): React.ReactElement {
  return <div className="manage-x-link-requests">
    <ConsolePageHeader title="X ID 申請"
      description="X ID連携申請の内容を確認します。承認・却下操作は移行検証中です。"
      backHref="/manage" backLabel="イベント運営トップへ" accent>
      <span className="fn-badge fn-badge-soft">{data.rows.length}件</span>
    </ConsolePageHeader>
    <section className="fn-console-section">
      {data.rows.length === 0
        ? <p className="fn-muted fn-text-sm">承認待ちの X ID 連携申請はありません。</p>
        : <FnTable className="approval-queue-table approval-queue-table-xid">
          <thead><tr><th>申請 ID</th><th>X ID</th><th>種別</th><th>申請者</th><th>申請日時</th></tr></thead>
          <tbody>{data.rows.map((row) => <Row key={row.id} row={row} />)}</tbody>
        </FnTable>}
    </section>
  </div>;
}

export function xLinkRequestRedirect(result: OpsResult<ManageXLinkRequestsResponse> | { status: "loading" }): string | null {
  if (result.status === "anonymous") return "/entry?next=%2Fmanage%2Fx-link-requests";
  if (result.status === "forbidden") return result.reason === "manage_access_required"
    ? "/dashboard" : AUTH_UNAVAILABLE;
  return null;
}

/** OpsGate controls the surface; Hono manageGate controls privileged X link permissions. */
export function ManageXLinkRequestsView({ data }: {
  data: OpsDataState<ManageXLinkRequestsResponse>;
}): React.ReactElement {
  if (data.status === "loading" || xLinkRequestRedirect(data)) {
    return <div role="status" aria-busy="true">読み込み中...</div>;
  }
  if (data.status === "notFound") return <NotFoundView />;
  if (data.status === "ok") return <ManageXLinkRequestsBody data={data.data} />;
  return <div role="alert">X ID連携申請を取得できませんでした。再読み込みしてください。</div>;
}

export function ManageXLinkRequests({ fetchFn = DEFAULT_FETCH }: { fetchFn?: OpsFetch }): React.ReactElement {
  const data = useApiResult((signal) => readManageXLinkRequests(fetchFn, signal), "manage-x-link-requests");
  const redirect = xLinkRequestRedirect(data);
  React.useEffect(() => { if (redirect) window.location.assign(redirect); }, [redirect]);
  return <ManageXLinkRequestsView data={data} />;
}
