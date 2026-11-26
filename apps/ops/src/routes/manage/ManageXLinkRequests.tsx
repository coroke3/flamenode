/** MIG-0725 U03c: unmounted X ID queue and injected review UI. Live writes await MIG-0605. */
import * as React from "react";
import type { ManageXLinkRequest, ManageXLinkRequestsResponse } from "@flamenode/contracts";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { readManageXLinkRequests, type XIdLinkReviewResult } from "../../api/manageXLinkRequests.js";
import type { OpsWriteResult } from "../../api/write.js";
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

function Row({ row, children }: { row: ManageXLinkRequest; children?: React.ReactNode }): React.ReactElement {
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
    {children}
  </tr>;
}

type ReviewActions = {
  // Opaque, nonempty host-verified authorization generation. Rotate after
  // reauthentication, account/capability changes, and authoritative revalidation.
  authorizationEpoch: string;
  approve: (requestId: string) => Promise<OpsWriteResult<XIdLinkReviewResult>>;
  reject: (requestId: string, reason: string) => Promise<OpsWriteResult<XIdLinkReviewResult>>;
  onRefresh: () => void | Promise<void>;
  onAnonymous: () => void;
};

const REVIEW_UNAVAILABLE = "通信または処理中に問題が発生しました。再読み込みしてお試しください。";

function isLinkRequest(row: ManageXLinkRequest): boolean {
  return row.request_type === "new_link" || row.request_type === "existing_link";
}

/**
 * Contract-first candidate: absent reviewActions means read-only.
 * A future authorized host may inject a stable adapter only after MIG-0605.
 * Rotate its authorizationEpoch on verified authority changes, not ordinary
 * queue refresh. The queue is global; do not assume different actors have
 * disjoint write scopes. Server-side permission, CAS and audit are authoritative.
 */
export function ManageXLinkRequestsBody({ data, reviewActions: proposedActions }: {
  data: ManageXLinkRequestsResponse; reviewActions?: ReviewActions;
}): React.ReactElement {
  const reviewActions = typeof proposedActions?.authorizationEpoch === "string" &&
    proposedActions.authorizationEpoch.trim() ? proposedActions : undefined;
  const epoch = reviewActions?.authorizationEpoch;
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [authLost, setAuthLost] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState<ReadonlySet<string>>(() => new Set());
  const acknowledgedRef = React.useRef(new Set<string>());
  const [quarantined, setQuarantined] = React.useState<ReadonlySet<string>>(() => new Set());
  const quarantinedRef = React.useRef(new Set<string>());
  const inFlight = React.useRef<{ rowId: string; generation: object } | null>(null);
  const denied = React.useRef(false);
  const generation = React.useRef<object | null>(null);
  const lastAuthorizedEpoch = React.useRef<string | undefined>(undefined);
  const actionsRef = React.useRef(reviewActions);

  React.useLayoutEffect(() => {
    // A committed adapter/epoch transition invalidates receipts even if the
    // very same adapter object later returns (A -> B -> A or A -> absent -> A).
    const token = {};
    generation.current = token;
    actionsRef.current = reviewActions;
    const outstanding = inFlight.current;
    if (outstanding && outstanding.generation !== token) {
      // The abandoned write may already have committed. Keep the global
      // single-flight lock until it settles, and fence that request from replay
      // for this mounted candidate. The future host must reconcile by authorized
      // read/CAS; do not infer non-commit or retry from an obsolete receipt.
      quarantinedRef.current.add(outstanding.rowId);
      setQuarantined(new Set(quarantinedRef.current));
    }
    setMessage(null);
    setRejectingId(null);
    setReason("");
    if (epoch !== undefined && epoch !== lastAuthorizedEpoch.current) {
      // Only a new explicit authority generation may clear a prior 401.
      lastAuthorizedEpoch.current = epoch;
      denied.current = false;
      setAuthLost(false);
      // Retain no-replay protection for previously acknowledged global IDs,
      // without carrying their success messages into the next generation.
      for (const id of acknowledgedRef.current) quarantinedRef.current.add(id);
      setQuarantined(new Set(quarantinedRef.current));
      acknowledgedRef.current.clear();
      setAcknowledged(new Set());
    }
    return () => { generation.current = null; actionsRef.current = undefined; };
  }, [reviewActions, epoch]);

  React.useLayoutEffect(() => {
    if (rejectingId !== null && !data.rows.some(row => row.id === rejectingId && isLinkRequest(row))) {
      setRejectingId(null);
      setReason("");
    }
  }, [data.rows, rejectingId]);

  function closeReject(): void {
    setRejectingId(null);
    setReason("");
  }

  async function run(row: ManageXLinkRequest, action: "approve" | "reject"): Promise<void> {
    const adapter = actionsRef.current;
    const token = generation.current;
    if (!adapter || !token || denied.current || inFlight.current ||
        !isLinkRequest(row) || acknowledgedRef.current.has(row.id) ||
        quarantinedRef.current.has(row.id)) return;
    // Synchronous global queue fence: the old finally may release only its own
    // operation, never a newer one. Context rotation is not server cancellation.
    const operation = { rowId: row.id, generation: token };
    inFlight.current = operation;
    setPending(true);
    setMessage(null);
    const isCurrent = () => generation.current === token && actionsRef.current === adapter;
    try {
      const result = action === "approve"
        ? await adapter.approve(row.id)
        : await adapter.reject(row.id, reason.trim().slice(0, 500));
      if (!isCurrent()) return;
      if (result.status === "anonymous") {
        denied.current = true;
        setAuthLost(true);
        adapter.onAnonymous();
        return;
      }
      if (result.status !== "ok") {
        setMessage(REVIEW_UNAVAILABLE);
        return;
      }
      setMessage(result.data.message ?? (result.data.ok ? "処理しました。" : "処理に失敗しました。"));
      if (result.data.ok) {
        // Do not allow another write for an acknowledged pending record if a
        // refresh fails or returns the old queue. Do not replay the POST.
        acknowledgedRef.current.add(row.id);
        setAcknowledged(new Set(acknowledgedRef.current));
        closeReject();
        try {
          await adapter.onRefresh();
        } catch {
          if (isCurrent()) setMessage((current) => (current ?? "処理しました。") + " 一覧の再取得に失敗しました。再読み込みしてください。");
        }
      }
    } catch {
      if (isCurrent() && !denied.current) setMessage(REVIEW_UNAVAILABLE);
    } finally {
      if (inFlight.current === operation) {
        inFlight.current = null;
        if (generation.current !== null) setPending(false);
      }
    }
  }

  if (authLost) return <div role="status" aria-busy="true">読み込み中...</div>;

  return <div className="manage-x-link-requests">
    <ConsolePageHeader title="X ID 申請"
      description={reviewActions ? "X ID連携申請を承認・却下します。統合操作は管理者画面に限定されます。" : "X ID連携申請の内容を確認します。承認・却下操作は移行検証中です。"}
      backHref="/manage" backLabel="イベント運営トップへ" accent>
      <span className="fn-badge fn-badge-soft">{data.rows.length}件</span>
    </ConsolePageHeader>
    <section className="fn-console-section">
      {message ? <p role="status" className="fn-text-sm">{message}</p> : null}
      {data.rows.length === 0
        ? <p className="fn-muted fn-text-sm">承認待ちの X ID 連携申請はありません。</p>
        : <FnTable className="approval-queue-table approval-queue-table-xid">
          <thead><tr><th>申請 ID</th><th>X ID</th><th>種別</th><th>申請者</th><th>申請日時</th>{reviewActions ? <th>操作</th> : null}</tr></thead>
          <tbody>{data.rows.map((row) => <Row key={row.id} row={row}>
            {reviewActions ? <td>
              {isLinkRequest(row) ? <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="fn-btn fn-btn-primary fn-btn-sm"
                    disabled={pending || acknowledged.has(row.id) || quarantined.has(row.id)}
                    onClick={() => { void run(row, "approve"); }}>承認</button>
                  <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={pending || acknowledged.has(row.id) || quarantined.has(row.id)}
                    onClick={() => {
                      setRejectingId(rejectingId === row.id ? null : row.id);
                      setReason("");
                    }}>却下</button>
                </div>
                {rejectingId === row.id && !acknowledged.has(row.id) && !quarantined.has(row.id) ? <div style={{
                  marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxWidth: 280,
                }}>
                  <textarea className="fn-input" placeholder="却下理由 (任意・履歴に残る)"
                    aria-label="却下理由" rows={2} maxLength={500} disabled={pending}
                    value={reason} onChange={(event) => setReason(event.target.value.slice(0, 500))} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="fn-btn fn-btn-danger fn-btn-sm"
                      disabled={pending} onClick={() => { void run(row, "reject"); }}>理由を添えて却下</button>
                    <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={pending} onClick={closeReject}>キャンセル</button>
                  </div>
                </div> : null}
              </> : "—"}
            </td> : null}
          </Row>)}</tbody>
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
