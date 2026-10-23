import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { SettingsResponse, SettingsXId, XApprovalStatus, XIdentityRequestRow } from "@flamenode/contracts";
import type { PersonalApi } from "../../api/personal.js";
import { ResultView, useApiResult } from "../guard.js";
import { onboardingHref, onboardingRulesHref, settingsGateNext, settingsNext } from "../next.js";
import { AppLink, ExternalRedirect, useDocumentTitle } from "../ui/AppLink.js";
import { formatUnix } from "../ui/format.js";
import { Icon } from "../ui/Icon.js";

type UtilityTabId = "discord" | "link" | "history";

/** CURRENT parseUtilityTab. */
function parseUtilityTab(value: string | null): UtilityTabId | null {
  if (value === "pending") return "history";
  if (value === "discord" || value === "link" || value === "history") return value;
  return null;
}

/** CURRENT sortXIds. */
function sortXIds(xIds: readonly SettingsXId[], activeXUserId: string | null): SettingsXId[] {
  const order = (status: XApprovalStatus) => (status === "approved" ? 0 : status === "pending" ? 1 : 2);
  return [...xIds].sort((a, b) => {
    if (a.id === activeXUserId) return -1;
    if (b.id === activeXUserId) return 1;
    return order(a.approval_status) - order(b.approval_status);
  });
}

/**
 * CURRENT app/(auth)/dashboard/settings/page.tsx, read-only part (MIG-0701).
 * The forms (X ID link / merge / profile / active switch / unlink / withdraw / revert) are MIG-0702:
 * they are not rendered here and no write is sent.
 * ?tab / ?x / ?onboarding / ?next live in the URL (deep link, reload, back-forward).
 */
export function Settings({ api }: { api: PersonalApi }): React.ReactElement {
  useDocumentTitle("設定");
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const x = params.get("x");
  const onboarding = params.get("onboarding");
  const state = useApiResult(api, `settings?tab=${tab ?? ""}&x=${x ?? ""}&onboarding=${onboarding ?? ""}`, (a, signal) =>
    a.getSettings({ tab, x, onboarding }, signal),
  );
  return (
    <ResultView state={state} next={settingsGateNext(params.get("next"))}>
      {(data) => (
        <SettingsView data={data} tab={tab} x={x} isOnboarding={onboarding === "1"} next={settingsNext(params.get("next"))} />
      )}
    </ResultView>
  );
}

export function SettingsView({
  data,
  tab,
  x: requestedXRaw,
  isOnboarding,
  next,
}: {
  data: SettingsResponse;
  tab: string | null;
  x: string | null;
  isOnboarding: boolean;
  next: string | null;
}): React.ReactElement {
  const { user, xIds, requestHistory } = data;

  if (isOnboarding && (user.is_tos_accepted !== 1 || user.terms_reaccept_required === 1)) {
    return <ExternalRedirect to={onboardingRulesHref(onboardingHref(next ?? "/dashboard"))} />;
  }

  const legacyTab = tab === "account" || tab === "xids" ? tab : null;
  const utilityTab = legacyTab ? null : parseUtilityTab(tab);
  const hasLinkedXIds = xIds.length > 0;
  const pendingRequestCount = requestHistory.filter((request) => request.status === "pending").length;

  const sortedXIds = sortXIds(xIds, user.active_x_user_id);
  const requestedX = requestedXRaw?.trim() ?? null;
  const selectedX =
    utilityTab == null && requestedX ? (xIds.find((row) => row.id.toLowerCase() === requestedX.toLowerCase()) ?? null) : null;
  const defaultX =
    (user.active_x_user_id ? xIds.find((row) => row.id === user.active_x_user_id) : null) ?? sortedXIds[0] ?? null;
  const activeXPanel = selectedX ?? defaultX;

  const showUtilityTab: UtilityTabId | null = isOnboarding
    ? "link"
    : (utilityTab ??
      (xIds.length === 0 && requestHistory.length === 0
        ? "link"
        : xIds.length === 0 && requestHistory.length > 0
          ? "history"
          : null));
  const xTabSelected = showUtilityTab == null && activeXPanel != null;

  const buildSettingsHref = (opts: { x?: string | null; tab?: UtilityTabId | null }): string => {
    const qs = new URLSearchParams();
    if (isOnboarding) qs.set("onboarding", "1");
    if (opts.tab) {
      qs.set("tab", opts.tab);
    } else if (opts.x) {
      qs.set("x", opts.x);
    }
    if (next) qs.set("next", next);
    const query = qs.toString();
    return query ? `/dashboard/settings?${query}` : "/dashboard/settings";
  };

  return (
    <div className="fn-public-container fn-page settings-wrap">
      <header className="fn-page-head settings-hd">
        {!isOnboarding ? (
          <AppLink href="/dashboard" className="settings-back">
            ← ダッシュボード
          </AppLink>
        ) : (
          <p className="settings-onboardingEyebrow">初回セットアップ</p>
        )}
        <h1 className="fn-display fn-page-title">{isOnboarding ? "X ID を登録" : "設定"}</h1>
        {isOnboarding ? (
          <p className="fn-page-lead">
            FlameNode を使うには、活動名義となる X ID の連携申請が必要です。申請後は運営が承認します。
          </p>
        ) : (
          <SettingsPageLead hasLinkedXIds={hasLinkedXIds} pendingCount={pendingRequestCount} />
        )}
        {next && !isOnboarding ? (
          <div className="settings-nextRow">
            <AppLink href={next} className="fn-btn fn-btn-primary fn-btn-sm">
              <Icon name="chevron-right" size={13} aria-hidden />
              元の画面へ戻る
            </AppLink>
          </div>
        ) : null}
      </header>

      {!isOnboarding ? (
        <nav className="settings-tabs" aria-label="X ID とアカウント">
          <div className="settings-tabList" role="tablist">
            {sortedXIds.map((row) => {
              const selected = xTabSelected && activeXPanel?.id === row.id;
              const isActive = row.id === user.active_x_user_id;
              return (
                <AppLink
                  key={row.id}
                  href={buildSettingsHref({ x: row.id })}
                  role="tab"
                  aria-selected={selected}
                  aria-controls="settings-panel-x"
                  className={`settings-tab ${selected ? "settings-tabActive" : ""} ${isActive ? "settings-tabCurrent" : ""}`}
                >
                  <SettingsTabAvatar iconUrl={row.icon_url} label={row.x_name || row.id} />
                  <span className="settings-tabBody">
                    <span className="settings-tabLabel">
                      {row.x_name && row.x_name !== row.id ? row.x_name : `@${row.id}`}
                    </span>
                    <span className="settings-tabMeta">
                      @{row.id}
                      {isActive && row.approval_status === "approved" ? " · アクティブ" : ""}
                    </span>
                  </span>
                </AppLink>
              );
            })}

            {requestHistory.length > 0 ? (
              <AppLink
                href={buildSettingsHref({ tab: "history" })}
                role="tab"
                aria-selected={showUtilityTab === "history"}
                aria-controls="settings-panel-history"
                className={`settings-tab ${showUtilityTab === "history" ? "settings-tabActive" : ""}`}
              >
                <span className="settings-tabIcon settings-tabIconMuted" aria-hidden>
                  <Icon name="clock" size={16} />
                </span>
                <span className="settings-tabBody">
                  <span className="settings-tabLabel">申請履歴</span>
                  <span className="settings-tabMeta">
                    {pendingRequestCount > 0 ? `${pendingRequestCount}件申請中` : `${requestHistory.length}件`}
                  </span>
                </span>
              </AppLink>
            ) : null}

            <AppLink
              href={buildSettingsHref({ tab: "link" })}
              role="tab"
              aria-selected={showUtilityTab === "link"}
              aria-controls="settings-panel-link"
              className={`settings-tab ${showUtilityTab === "link" ? "settings-tabActive" : ""}`}
            >
              <span className="settings-tabIcon settings-tabIconMuted" aria-hidden>
                <Icon name="plus" size={16} />
              </span>
              <span className="settings-tabBody">
                <span className="settings-tabLabel">X ID連携</span>
                <span className="settings-tabMeta">X IDを連携</span>
              </span>
            </AppLink>

            <AppLink
              href={buildSettingsHref({ tab: "discord" })}
              role="tab"
              aria-selected={showUtilityTab === "discord"}
              aria-controls="settings-panel-discord"
              className={`settings-tab ${showUtilityTab === "discord" ? "settings-tabActive" : ""}`}
            >
              {user.image ? (
                <span className="settings-tabIcon" aria-hidden>
                  <img src={user.image} alt="" className="settings-tabIconImg" />
                </span>
              ) : (
                <span className="settings-tabIcon settings-tabIconMuted" aria-hidden>
                  <Icon name="discord" size={16} />
                </span>
              )}
              <span className="settings-tabBody">
                <span className="settings-tabLabel">Discord</span>
                <span className="settings-tabMeta">{user.name ?? "接続済み"}</span>
              </span>
            </AppLink>
          </div>
        </nav>
      ) : null}

      {xTabSelected && activeXPanel ? (
        <section
          id="settings-panel-x"
          role="tabpanel"
          className="settings-card settings-cardAccent"
          aria-labelledby="settings-x-h"
        >
          <div className="settings-cardHd">
            <h2 id="settings-x-h" className="settings-cardTitle">
              @{activeXPanel.id}
            </h2>
            <p className="settings-cardDesc">この X ID の公開プロフィールとアクティブ設定を管理します。</p>
          </div>
          <XAccountPanel x={activeXPanel} isActive={activeXPanel.id === user.active_x_user_id} />
        </section>
      ) : null}

      {showUtilityTab === "history" ? (
        <section id="settings-panel-history" role="tabpanel" className="settings-card" aria-labelledby="settings-history-h">
          <div className="settings-cardHd settings-cardHdBordered">
            <h2 id="settings-history-h" className="settings-cardTitle">
              X ID申請履歴
            </h2>
            <p className="settings-cardDesc">
              申請中・承認・却下・取り下げを含む全状態を、新しいものから最大50件確認できます。
            </p>
          </div>
          <RequestHistoryList rows={requestHistory} />
        </section>
      ) : null}

      {showUtilityTab === "link" ? (
        <section id="settings-panel-link" role="tabpanel" className="settings-card" aria-labelledby="settings-link-h">
          {!hasLinkedXIds ? <SettingsNoXIdOnboarding pendingCount={pendingRequestCount} /> : null}
          <div className="settings-cardHd settings-cardHdBordered">
            <h2 id="settings-link-h" className="settings-cardTitle">
              X IDを連携
            </h2>
            <p className="settings-cardDesc">
              @ を除いたユーザー名を入力して申請してください。初回・2件目以降とも同じ手順で、運営承認後に反映されます。
            </p>
          </div>
          {/* MIG-0702: XIdLinkForm (X ID link request) */}
          {isOnboarding && requestHistory.length > 0 ? (
            <div className="settings-addBox">
              <h3 className="settings-cardTitle">申請履歴</h3>
              <p className="settings-cardDesc">申請済みのX IDと現在の状態を確認できます。</p>
              <RequestHistoryList rows={requestHistory} />
            </div>
          ) : null}
          {/* MIG-0702: XIdMergeForm (shown when two or more X IDs are approved) */}
        </section>
      ) : null}

      {showUtilityTab === "discord" ? (
        <section id="settings-panel-discord" role="tabpanel" className="settings-card" aria-labelledby="settings-discord-h">
          <div className="settings-cardHd settings-cardHdBordered">
            <h2 id="settings-discord-h" className="settings-cardTitle">
              Discord
            </h2>
            <p className="settings-cardDesc">FlameNode のログインに使用しています。変更はできません。</p>
          </div>
          <div className="settings-discordBadge">
            {user.image ? (
              <span className="settings-discordAvatar" aria-hidden="true">
                <img src={user.image} alt="" className="settings-avatarImg" />
              </span>
            ) : (
              <span className="settings-discordAvatar" aria-hidden="true">
                {(user.name ?? "?").charAt(0)}
              </span>
            )}
            <div className="settings-discordId">
              <span className="settings-discordName">{user.name}</span>
              <span className="settings-discordMeta">
                <Icon name="discord" size={13} aria-hidden />
                {user.id}
              </span>
            </div>
            <span className="fn-badge fn-badge-neutral">接続済み</span>
          </div>
          <p className="settings-discordNote">
            Discord アカウントの変更・削除はできません。アカウントの削除をご希望の場合はお問い合わせください。
          </p>
        </section>
      ) : null}
    </div>
  );
}

function SettingsTabAvatar({ iconUrl, label }: { iconUrl: string | null; label: string }): React.ReactElement {
  const fallback = (label.trim().charAt(0) || "?").toUpperCase();
  if (iconUrl) {
    return (
      <span className="settings-tabIcon" aria-hidden>
        <img src={iconUrl} alt="" className="settings-tabIconImg" />
      </span>
    );
  }
  return (
    <span className="settings-tabIcon" aria-hidden>
      {fallback}
    </span>
  );
}

/** CURRENT SettingsPageLead (components/settings/SettingsNoXIdOnboarding.tsx). */
function SettingsPageLead({ hasLinkedXIds, pendingCount }: { hasLinkedXIds: boolean; pendingCount: number }): React.ReactElement {
  if (!hasLinkedXIds) {
    return (
      <p className="fn-page-lead">
        まず X ID を連携してください。承認後にいいね・セーブ・投稿ができます（枠確保は規約同意後から可能）。
        {pendingCount > 0 ? " 申請中の連携は「申請履歴」タブで確認できます。" : ""}
      </p>
    );
  }
  return <p className="fn-page-lead">連携した X ID ごとにプロフィールを編集し、アクティブ X ID を切り替えます。</p>;
}

/** CURRENT SettingsNoXIdOnboarding. */
function SettingsNoXIdOnboarding({ pendingCount }: { pendingCount: number }): React.ReactElement {
  return (
    <div className="settings-onboarding" role="status">
      <div className="settings-onboardingIcon" aria-hidden>
        <Icon name="x" size={22} />
      </div>
      <div className="settings-onboardingBody">
        <h2 className="settings-onboardingTitle">X ID を連携しましょう</h2>
        <p className="settings-onboardingLead">
          FlameNode では Discord でログインし、利用規約に同意したうえで活動名義となる X ID
          を連携します。申請後は運営が目視確認して承認します。
        </p>
        <ul className="settings-onboardingList">
          <li>作品の閲覧はログインなしでも可能です</li>
          <li>枠確保は規約同意後から利用できます。投稿は X ID 承認後</li>
          <li>いいね・セーブ・投稿には承認済みの活動名義（Active X ID）が必要です</li>
          <li>複数の X ID を連携し、アクティブを切り替えられます</li>
        </ul>
        {pendingCount > 0 ? (
          <p className="settings-onboardingPending">
            <Icon name="clock" size={13} aria-hidden />
            承認待ちの申請が {pendingCount} 件あります。「申請履歴」タブで確認できます。
          </p>
        ) : null}
      </div>
    </div>
  );
}

const STATUS_PILL: Record<XApprovalStatus, { label: string; className: string; dot?: boolean; check?: boolean }> = {
  approved: { label: "承認済み", className: "fn-badge fn-badge-neutral", check: true },
  pending: { label: "申請中", className: "fn-badge fn-badge-warning", dot: true },
  rejected: { label: "却下", className: "fn-badge fn-badge-neutral", dot: true },
  imported: { label: "移行済み", className: "fn-badge fn-badge-neutral", check: true },
};

/** CURRENT SettingsStatusPill. */
function StatusPill({ status }: { status: XApprovalStatus }): React.ReactElement {
  const m = STATUS_PILL[status];
  return (
    <span className={m.className}>
      {m.dot ? (
        <span className="settings-pillDot" aria-hidden="true">
          ●
        </span>
      ) : null}
      {m.check ? <Icon name="check" size={11} aria-hidden /> : null}
      {m.label}
    </span>
  );
}

/** CURRENT SettingsXAccountPanel without the MIG-0702 forms (active switch, unlink, profile edit). */
function XAccountPanel({ x, isActive }: { x: SettingsXId; isActive: boolean }): React.ReactElement {
  const approved = x.approval_status === "approved";
  const imported = x.approval_status === "imported";
  const publicHref = approved || imported ? `/user/${encodeURIComponent(x.id)}` : null;
  const linkedLabel = x.requested_at ? `${formatUnix(x.requested_at, { dateOnly: true })} 連携` : "連携日未記録";
  return (
    <div className="settings-accountPanel">
      <div className="settings-activePanel">
        {x.icon_url ? (
          <span className="settings-avatar" aria-hidden="true">
            <img src={x.icon_url} alt="" className="settings-avatarImg" />
          </span>
        ) : (
          <span className="settings-avatar" aria-hidden="true">
            {x.id.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="settings-activeId">
          {publicHref ? (
            <AppLink href={publicHref} className="settings-activeNameLink" target="_blank" rel="noopener noreferrer">
              {x.x_name || x.id}
            </AppLink>
          ) : (
            <span className="settings-activeName">{x.x_name || x.id}</span>
          )}
          <span className="settings-activeHandle">
            <Icon name="x" size={11} aria-hidden />@{x.id}
          </span>
          <span className="settings-rowDate">{linkedLabel}</span>
        </div>
        <div className="settings-activeBadges">
          <StatusPill status={x.approval_status} />
          {isActive && approved ? <span className="fn-badge fn-badge-accent">アクティブ</span> : null}
        </div>
      </div>

      <div className="settings-accountActions">
        {isActive && approved ? (
          <span className="settings-activeMarker">
            <Icon name="check" size={12} aria-hidden />
            投稿・枠確保で使用中
          </span>
        ) : null}
        {/* MIG-0702: SetActiveXButton ("アクティブに設定", approved && !isActive) */}
        {publicHref ? (
          <AppLink href={publicHref} className="settings-actionBtn" target="_blank" rel="noopener noreferrer">
            <Icon name="user" size={12} aria-hidden />
            公開ページ
          </AppLink>
        ) : null}
        {/* MIG-0702: DeleteXIdForm ("連携を解除", !isActive) */}
        {x.approval_status === "rejected" ? (
          <span
            className="settings-actionBtn settings-actionBtnMuted"
            title="却下された X ID の再審査は運営が行います。"
          >
            再申請待ち
          </span>
        ) : null}
      </div>

      {/* MIG-0702: approved -> "公開プロフィール" XIdCompactProfileForm */}
      {x.approval_status === "pending" ? (
        <p className="settings-accountNote">運営の承認後、この X ID をアクティブに設定して投稿できます。</p>
      ) : imported ? (
        <p className="settings-accountNote">
          旧データから移行された X ID です。公開ページでは表示されますが、プロフィールの編集は運営の承認後に行えます。
        </p>
      ) : x.approval_status === "rejected" ? (
        <p className="settings-accountNote">却下された X ID です。再審査が必要な場合は運営にお問い合わせください。</p>
      ) : null}
    </div>
  );
}

const REQUEST_TYPE_LABELS: Record<XIdentityRequestRow["request_type"], string> = {
  new_link: "X ID連携",
  existing_link: "X ID連携",
  alias: "旧別名申請",
  merge: "X ID統合",
  revert_merge: "統合取消",
};

const REQUEST_STATUS_LABELS: Record<XIdentityRequestRow["status"], string> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  done: "完了",
  cancelled: "取消済み",
};

function requestTarget(row: XIdentityRequestRow): string {
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
  if (row.request_type === "revert_merge") {
    return row.source_x_user_id && row.target_x_user_id
      ? `@${row.target_x_user_id} → @${row.source_x_user_id} の取消`
      : "統合取消申請";
  }
  return row.requested_x_id ? `@${row.requested_x_id}` : "X ID連携";
}

function requestStatusClass(status: XIdentityRequestRow["status"]): string {
  if (status === "pending") return "fn-badge fn-badge-warning";
  if (status === "rejected" || status === "cancelled") return "fn-badge fn-badge-danger";
  return "fn-badge fn-badge-accent";
}

/** CURRENT XIdentityRequestHistoryList without the MIG-0702 withdraw / revert buttons. */
function RequestHistoryList({ rows }: { rows: readonly XIdentityRequestRow[] }): React.ReactElement | null {
  if (rows.length === 0) return null;

  const now = Math.floor(Date.now() / 1000);
  const blockedRevertParents = new Set(
    rows
      .filter(
        (row) =>
          row.request_type === "revert_merge" &&
          (row.status === "pending" || row.status === "approved" || row.status === "done") &&
          row.parent_request_id,
      )
      .map((row) => row.parent_request_id as string),
  );

  return (
    <div>
      <ul className="settings-list settings-listTight">
        {rows.map((row) => {
          const revertBlocked = blockedRevertParents.has(row.id);
          const canRequestRevert =
            row.request_type === "merge" &&
            row.status === "done" &&
            typeof row.revert_deadline_at === "number" &&
            row.revert_deadline_at >= now &&
            !revertBlocked;
          const revertDeadlinePassed =
            row.request_type === "merge" &&
            row.status === "done" &&
            !revertBlocked &&
            typeof row.revert_deadline_at === "number" &&
            row.revert_deadline_at < now;
          return (
            <li key={row.id} className="settings-row">
              <div className="settings-rowHead">
                <span className="settings-avatar settings-avatarSm settings-avatarPending" aria-hidden="true">
                  ?
                </span>
                <div className="settings-rowInfo">
                  <span className="settings-rowName">{requestTarget(row)}</span>
                  <span className="settings-rowDate">
                    {REQUEST_TYPE_LABELS[row.request_type]}・ {formatUnix(row.requested_at, { dateOnly: true })}{" "}
                    {formatUnix(row.requested_at, { timeOnly: true })} 申請
                    {row.status !== "pending" && row.updated_at !== row.requested_at
                      ? `・最終更新 ${formatUnix(row.updated_at, { dateOnly: true })} ${formatUnix(row.updated_at, { timeOnly: true })}`
                      : ""}
                  </span>
                  {row.request_type === "merge" ? (
                    <span className="settings-rowDate">
                      作品・合作メンバー・チャプター・予約枠・審査案件を統合先へ付け替え、統合元を無効化
                    </span>
                  ) : null}
                  {canRequestRevert && row.revert_deadline_at != null ? (
                    <span className="settings-rowDate">
                      {formatUnix(row.revert_deadline_at, { dateOnly: true })}{" "}
                      {formatUnix(row.revert_deadline_at, { timeOnly: true })} まで取り消し申請できます
                    </span>
                  ) : null}
                  {revertBlocked && row.request_type === "merge" ? (
                    <span className="settings-rowDate">差し戻し済み、または申請中です</span>
                  ) : null}
                  {revertDeadlinePassed ? <span className="settings-rowDate">差し戻し期限を過ぎています</span> : null}
                </div>
                <div className="settings-rowBadges">
                  <span className={requestStatusClass(row.status)}>{REQUEST_STATUS_LABELS[row.status]}</span>
                </div>
              </div>
              {/* MIG-0702: "取り下げる" (pending) / "統合を取り消す申請" (canRequestRevert) buttons */}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
