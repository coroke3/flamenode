import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { xIdentityRequests as linkReqTable } from "@/lib/db/schema";
import { getLinkedXUsersForAuthUser } from "@/lib/auth/xIdentity";
import { requireSession } from "@/lib/auth/guard";
import { onboardingHref, onboardingRulesHref } from "@/lib/auth/onboardingUrls";
import { Icon } from "@/components/ui/Icon";
import {
  XIdLinkForm,
  XIdMergeForm,
} from "@/components/settings/XIdSettingsClient";
import {
  XIdentityRequestHistoryList,
  type SettingsXIdRow,
} from "@/components/settings/XIdLinkedList";
import { SettingsXAccountPanel } from "@/components/settings/SettingsXAccountPanel";
import {
  SettingsNoXIdOnboarding,
  SettingsPageLead,
} from "@/components/settings/SettingsNoXIdOnboarding";
import pageStyles from "@/components/settings/settings-page.module.css";
import { sanitizeNextPath } from "#utils/next";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { getYoutubeChannelCandidates } from "@/lib/db/youtubeChannelCandidates";
import { normalizePortfolioContact } from "@/lib/profileContact";

export const metadata: Metadata = { title: "設定" };
export const dynamic = "force-dynamic";

type UtilityTabId = "discord" | "link" | "history";

function parseUtilityTab(value: string | undefined): UtilityTabId | null {
  if (value === "pending") return "history";
  if (value === "discord" || value === "link" || value === "history") {
    return value;
  }
  return null;
}

function sortXIds(
  xIds: SettingsXIdRow[],
  activeXUserId: string | null,
): SettingsXIdRow[] {
  const order = (status: SettingsXIdRow["approval_status"]) =>
    status === "approved" ? 0 : status === "pending" ? 1 : 2;
  return [...xIds].sort((a, b) => {
    if (a.id === activeXUserId) return -1;
    if (b.id === activeXUserId) return 1;
    return order(a.approval_status) - order(b.approval_status);
  });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    next?: string;
    tab?: string;
    x?: string;
    onboarding?: string;
  }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const isOnboarding = params?.onboarding === "1";
  const legacyTab =
    params?.tab === "account" || params?.tab === "xids" ? params.tab : null;
  const utilityTab = legacyTab ? null : parseUtilityTab(params?.tab);
  const rawNext = params?.next?.trim();
  const next =
    rawNext && rawNext !== "/dashboard/settings"
      ? sanitizeNextPath(rawNext, "/dashboard")
      : null;
  const guard = await requireSession({
    next: next ?? "/dashboard/settings",
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  if (
    isOnboarding &&
    (user.is_tos_accepted !== 1 || user.terms_reaccept_required === 1)
  ) {
    redirect(
      onboardingRulesHref(onboardingHref(next ?? "/dashboard")),
    );
  }

  const db = getDatabase();
  const xIdsRaw = db ? await getLinkedXUsersForAuthUser(db, user.id) : [];

  const requestHistory = db
    ? await db
        .select({
          id: linkReqTable.id,
          request_type: linkReqTable.request_type,
          requested_x_id: linkReqTable.requested_x_id,
          source_x_user_id: linkReqTable.source_x_user_id,
          target_x_user_id: linkReqTable.target_x_user_id,
          status: linkReqTable.status,
          requested_at: linkReqTable.requested_at,
          updated_at: linkReqTable.updated_at,
        })
        .from(linkReqTable)
        .where(eq(linkReqTable.requested_by_auth_user_id, user.id))
        .orderBy(desc(linkReqTable.requested_at), desc(linkReqTable.id))
        .limit(50)
    : [];

  const xIds: SettingsXIdRow[] = xIdsRaw.map((x) => ({
    id: x.x_user_id,
    x_name: x.x_name,
    icon_url: x.icon_url,
    approval_status:
      x.approval_status === "approved" ||
      x.approval_status === "pending" ||
      x.approval_status === "rejected" ||
      x.approval_status === "imported"
        ? x.approval_status
        : "pending",
    requested_at: x.request_requested_at ?? x.created_at,
    profile_text: x.profile_text,
    portfolio_contact: normalizePortfolioContact(x.portfolio_contact),
    youtube_channel_url: x.youtube_channel_url,
    other_social_links: x.other_social_links,
  }));

  const hasLinkedXIds = xIds.length > 0;
  const mergeCandidates = xIds
    .filter((x) => x.approval_status === "approved")
    .map((x) => ({ id: x.id, label: `@${x.id}` }));
  const pendingRequestCount = requestHistory.filter(
    (request) => request.status === "pending",
  ).length;

  const sortedXIds = sortXIds(xIds, user.active_x_user_id);
  const requestedX = params?.x?.trim() ?? null;
  const selectedX =
    utilityTab == null && requestedX
      ? xIds.find((x) => x.id.toLowerCase() === requestedX.toLowerCase()) ?? null
      : null;

  const defaultX =
    (user.active_x_user_id
      ? xIds.find((x) => x.id === user.active_x_user_id)
      : null) ??
    sortedXIds[0] ??
    null;

  const activeXPanel = selectedX ?? defaultX;

  const showUtilityTab =
    isOnboarding
      ? "link"
      : utilityTab ??
        (xIds.length === 0 && requestHistory.length === 0
          ? "link"
          : xIds.length === 0 && requestHistory.length > 0
            ? "history"
            : null);
  const xTabSelected = showUtilityTab == null && activeXPanel != null;

  // 候補フォームは表示中のActive X IDだけが使うため、全連携X IDを走査しない。
  const iconCandidatesById: Record<string, string[]> = {};
  const channelCandidatesById: Record<string, string[]> = {};
  if (db && xTabSelected && activeXPanel) {
    const [iconCandidates, channelCandidates] = await Promise.all([
      getXIconCandidates(db, activeXPanel.id, 12),
      getYoutubeChannelCandidates(db, activeXPanel.id, 24),
    ]);
    iconCandidatesById[activeXPanel.id] = iconCandidates;
    channelCandidatesById[activeXPanel.id] = channelCandidates;
  }

  const buildSettingsHref = (opts: {
    x?: string | null;
    tab?: UtilityTabId | null;
  }): string => {
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

  const onboardingSuccessHref = next ?? "/dashboard";

  return (
    <div className={`fn-public-container fn-page ${pageStyles.wrap}`}>
      <header className={`fn-page-head ${pageStyles.hd}`}>
        {!isOnboarding ? (
          <Link href="/dashboard" className={pageStyles.back}>
            ← ダッシュボード
          </Link>
        ) : (
          <p className={pageStyles.onboardingEyebrow}>初回セットアップ</p>
        )}
        <h1 className="fn-display fn-page-title">
          {isOnboarding ? "X ID を登録" : "設定"}
        </h1>
        {isOnboarding ? (
          <p className="fn-page-lead">
            FlameNode を使うには、活動名義となる X ID の連携申請が必要です。申請後は運営が承認します。
          </p>
        ) : (
          <SettingsPageLead
            hasLinkedXIds={hasLinkedXIds}
            pendingCount={pendingRequestCount}
          />
        )}
        {next && !isOnboarding ? (
          <div className={pageStyles.nextRow}>
            <Link href={next} className="fn-btn fn-btn-primary fn-btn-sm">
              <Icon name="chevron-right" size={13} aria-hidden />
              元の画面へ戻る
            </Link>
          </div>
        ) : null}
      </header>

      {!isOnboarding ? (
      <nav className={pageStyles.tabs} aria-label="X ID とアカウント">
        <div className={pageStyles.tabList} role="tablist">
          {sortedXIds.map((x) => {
            const selected = xTabSelected && activeXPanel?.id === x.id;
            const isActive = x.id === user.active_x_user_id;
            return (
              <Link
                key={x.id}
                href={buildSettingsHref({ x: x.id })}
                role="tab"
                aria-selected={selected}
                aria-controls="settings-panel-x"
                className={`${pageStyles.tab} ${
                  selected ? pageStyles.tabActive : ""
                } ${isActive ? pageStyles.tabCurrent : ""}`}
              >
                <SettingsTabAvatar
                  iconUrl={x.icon_url}
                  label={x.x_name || x.id}
                />
                <span className={pageStyles.tabBody}>
                  <span className={pageStyles.tabLabel}>
                    {x.x_name && x.x_name !== x.id ? x.x_name : `@${x.id}`}
                  </span>
                  <span className={pageStyles.tabMeta}>
                    @{x.id}
                    {isActive && x.approval_status === "approved"
                      ? " · アクティブ"
                      : ""}
                  </span>
                </span>
              </Link>
            );
          })}

          {requestHistory.length > 0 ? (
            <Link
              href={buildSettingsHref({ tab: "history" })}
              role="tab"
              aria-selected={showUtilityTab === "history"}
              aria-controls="settings-panel-history"
              className={`${pageStyles.tab} ${
                showUtilityTab === "history" ? pageStyles.tabActive : ""
              }`}
            >
              <span
                className={`${pageStyles.tabIcon} ${pageStyles.tabIconMuted}`}
                aria-hidden
              >
                <Icon name="clock" size={16} />
              </span>
              <span className={pageStyles.tabBody}>
                <span className={pageStyles.tabLabel}>申請履歴</span>
                <span className={pageStyles.tabMeta}>
                  {pendingRequestCount > 0
                    ? `${pendingRequestCount}件申請中`
                    : `${requestHistory.length}件`}
                </span>
              </span>
            </Link>
          ) : null}

          <Link
            href={buildSettingsHref({ tab: "link" })}
            role="tab"
            aria-selected={showUtilityTab === "link"}
            aria-controls="settings-panel-link"
            className={`${pageStyles.tab} ${
              showUtilityTab === "link" ? pageStyles.tabActive : ""
            }`}
          >
            <span
              className={`${pageStyles.tabIcon} ${pageStyles.tabIconMuted}`}
              aria-hidden
            >
              <Icon name="plus" size={16} />
            </span>
            <span className={pageStyles.tabBody}>
              <span className={pageStyles.tabLabel}>
                X ID連携
              </span>
              <span className={pageStyles.tabMeta}>
                X IDを連携
              </span>
            </span>
          </Link>

          <Link
            href={buildSettingsHref({ tab: "discord" })}
            role="tab"
            aria-selected={showUtilityTab === "discord"}
            aria-controls="settings-panel-discord"
            className={`${pageStyles.tab} ${
              showUtilityTab === "discord" ? pageStyles.tabActive : ""
            }`}
          >
            {user.image ? (
              <span className={pageStyles.tabIcon} aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={user.image} alt="" className={pageStyles.tabIconImg} />
              </span>
            ) : (
              <span
                className={`${pageStyles.tabIcon} ${pageStyles.tabIconMuted}`}
                aria-hidden
              >
                <Icon name="discord" size={16} />
              </span>
            )}
            <span className={pageStyles.tabBody}>
              <span className={pageStyles.tabLabel}>Discord</span>
              <span className={pageStyles.tabMeta}>{user.name ?? "接続済み"}</span>
            </span>
          </Link>
        </div>
      </nav>
      ) : null}

      {xTabSelected && activeXPanel ? (
        <section
          id="settings-panel-x"
          role="tabpanel"
          className={`${pageStyles.card} ${pageStyles.cardAccent}`}
          aria-labelledby="settings-x-h"
        >
          <div className={pageStyles.cardHd}>
            <h2 id="settings-x-h" className={pageStyles.cardTitle}>
              @{activeXPanel.id}
            </h2>
            <p className={pageStyles.cardDesc}>
              この X ID の公開プロフィールとアクティブ設定を管理します。
            </p>
          </div>
          <SettingsXAccountPanel
            key={activeXPanel.id}
            x={activeXPanel}
            isActive={activeXPanel.id === user.active_x_user_id}
            iconCandidates={iconCandidatesById[activeXPanel.id] ?? []}
            channelCandidates={channelCandidatesById[activeXPanel.id] ?? []}
            next={next}
          />
        </section>
      ) : null}

      {showUtilityTab === "history" ? (
        <section
          id="settings-panel-history"
          role="tabpanel"
          className={pageStyles.card}
          aria-labelledby="settings-history-h"
        >
          <div className={`${pageStyles.cardHd} ${pageStyles.cardHdBordered}`}>
            <h2 id="settings-history-h" className={pageStyles.cardTitle}>
              X ID申請履歴
            </h2>
            <p className={pageStyles.cardDesc}>
              申請中・承認・却下・取り下げを含む全状態を、新しいものから最大50件確認できます。
            </p>
          </div>
          <XIdentityRequestHistoryList rows={requestHistory} />
        </section>
      ) : null}

      {showUtilityTab === "link" ? (
        <section
          id="settings-panel-link"
          role="tabpanel"
          className={pageStyles.card}
          aria-labelledby="settings-link-h"
        >
          {!hasLinkedXIds ? (
            <SettingsNoXIdOnboarding pendingCount={pendingRequestCount} />
          ) : null}
          <div className={`${pageStyles.cardHd} ${pageStyles.cardHdBordered}`}>
            <h2 id="settings-link-h" className={pageStyles.cardTitle}>
              X IDを連携
            </h2>
            <p className={pageStyles.cardDesc}>
              @ を除いたユーザー名を入力して申請してください。初回・2件目以降とも同じ手順で、運営承認後に反映されます。
            </p>
          </div>
          <div className={pageStyles.addBox}>
            <XIdLinkForm
              onSuccessRedirect={
                isOnboarding ? onboardingSuccessHref : next ?? null
              }
            />
          </div>
          {isOnboarding && requestHistory.length > 0 ? (
            <div className={pageStyles.addBox}>
              <h3 className={pageStyles.cardTitle}>申請履歴</h3>
              <p className={pageStyles.cardDesc}>
                申請済みのX IDと現在の状態を確認できます。
              </p>
              <XIdentityRequestHistoryList rows={requestHistory} />
            </div>
          ) : null}
          {mergeCandidates.length >= 2 ? (
            <div className={pageStyles.addBox}>
              <h3 className={pageStyles.cardTitle}>X ID統合申請</h3>
              <XIdMergeForm linkedXIds={mergeCandidates} />
            </div>
          ) : null}
        </section>
      ) : null}

      {showUtilityTab === "discord" ? (
        <section
          id="settings-panel-discord"
          role="tabpanel"
          className={pageStyles.card}
          aria-labelledby="settings-discord-h"
        >
          <div className={`${pageStyles.cardHd} ${pageStyles.cardHdBordered}`}>
            <h2 id="settings-discord-h" className={pageStyles.cardTitle}>
              Discord
            </h2>
            <p className={pageStyles.cardDesc}>
              FlameNode のログインに使用しています。変更はできません。
            </p>
          </div>
          <div className={pageStyles.discordBadge}>
            {user.image ? (
              <span className={pageStyles.discordAvatar} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={user.image}
                  alt=""
                  className={pageStyles.avatarImg}
                />
              </span>
            ) : (
              <span className={pageStyles.discordAvatar} aria-hidden="true">
                {(user.name ?? "?").charAt(0)}
              </span>
            )}
            <div className={pageStyles.discordId}>
              <span className={pageStyles.discordName}>{user.name}</span>
              <span className={pageStyles.discordMeta}>
                <Icon name="discord" size={13} aria-hidden />
                {user.id}
              </span>
            </div>
            <span className="fn-badge fn-badge-neutral">接続済み</span>
          </div>
          <p className={pageStyles.discordNote}>
            Discord アカウントの変更・削除はできません。アカウントの削除をご希望の場合はお問い合わせください。
          </p>
        </section>
      ) : null}
    </div>
  );
}

function SettingsTabAvatar({
  iconUrl,
  label,
}: {
  iconUrl: string | null;
  label: string;
}): React.ReactElement {
  const fallback = (label.trim().charAt(0) || "?").toUpperCase();
  if (iconUrl) {
    return (
      <span className={pageStyles.tabIcon} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" className={pageStyles.tabIconImg} />
      </span>
    );
  }
  return (
    <span className={pageStyles.tabIcon} aria-hidden>
      {fallback}
    </span>
  );
}
