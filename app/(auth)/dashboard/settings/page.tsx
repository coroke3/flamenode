import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  xAccountLinkRequests as linkReqTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { Icon } from "@/components/ui/Icon";
import { XIdLinkForm } from "@/components/settings/XIdSettingsClient";
import {
  PendingLinkRequestList,
  type PendingLinkRequestRow,
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

type UtilityTabId = "discord" | "link" | "pending";

function parseUtilityTab(value: string | undefined): UtilityTabId | null {
  if (value === "discord" || value === "link" || value === "pending") {
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

  const db = getDatabase();
  const xIdsRaw = db
    ? await db
        .select()
        .from(xUsersTable)
        .where(eq(xUsersTable.linked_user_id, user.id))
    : [];

  const pendingLinkRequests = db
    ? await db
        .select()
        .from(linkReqTable)
        .where(
          and(
            eq(linkReqTable.user_id, user.id),
            eq(linkReqTable.status, "pending"),
          )!,
        )
        .orderBy(desc(linkReqTable.requested_at))
    : [];

  const xIds: SettingsXIdRow[] = xIdsRaw.map((x) => ({
    id: x.id,
    x_name: x.x_name,
    icon_url: x.icon_url,
    approval_status:
      x.approval_status === "approved" ||
      x.approval_status === "pending" ||
      x.approval_status === "rejected"
        ? x.approval_status
        : "pending",
    approval_requested_at: x.approval_requested_at,
    profile_text: x.profile_text,
    portfolio_contact: normalizePortfolioContact(x.portfolio_contact),
    youtube_channel_url: x.youtube_channel_url,
    other_social_links: x.other_social_links,
  }));

  const linkedIds = new Set(xIds.map((x) => x.id.toLowerCase()));
  const pendingOnly: PendingLinkRequestRow[] = pendingLinkRequests
    .filter((r) => !linkedIds.has(r.requested_x_id.toLowerCase()))
    .map((r) => ({
      id: r.id,
      requested_x_id: r.requested_x_id,
      requested_at: r.requested_at,
    }));

  const iconCandidatesById: Record<string, string[]> = {};
  const channelCandidatesById: Record<string, string[]> = {};
  if (db && xIds.length > 0) {
    for (const x of xIds) {
      iconCandidatesById[x.id] = await getXIconCandidates(db, x.id, 12);
      channelCandidatesById[x.id] = await getYoutubeChannelCandidates(db, x.id, 24);
    }
  }

  const hasLinkedXIds = xIds.length > 0;
  const pendingRequestCount = pendingOnly.length;

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
        (xIds.length === 0 && pendingOnly.length === 0
          ? "link"
          : xIds.length === 0 && pendingOnly.length > 0
            ? "pending"
            : null);

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

  const xTabSelected = showUtilityTab == null && activeXPanel != null;

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

          {pendingOnly.length > 0 ? (
            <Link
              href={buildSettingsHref({ tab: "pending" })}
              role="tab"
              aria-selected={showUtilityTab === "pending"}
              aria-controls="settings-panel-pending"
              className={`${pageStyles.tab} ${
                showUtilityTab === "pending" ? pageStyles.tabActive : ""
              }`}
            >
              <span
                className={`${pageStyles.tabIcon} ${pageStyles.tabIconMuted}`}
                aria-hidden
              >
                <Icon name="clock" size={16} />
              </span>
              <span className={pageStyles.tabBody}>
                <span className={pageStyles.tabLabel}>申請中</span>
                <span className={pageStyles.tabMeta}>{pendingOnly.length}件</span>
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
                {hasLinkedXIds ? "新規連携" : "X ID連携"}
              </span>
              <span className={pageStyles.tabMeta}>
                {hasLinkedXIds ? "X ID を追加" : "最初の連携"}
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

      {showUtilityTab === "pending" ? (
        <section
          id="settings-panel-pending"
          role="tabpanel"
          className={pageStyles.card}
          aria-labelledby="settings-pending-h"
        >
          <div className={`${pageStyles.cardHd} ${pageStyles.cardHdBordered}`}>
            <h2 id="settings-pending-h" className={pageStyles.cardTitle}>
              承認待ちの申請
            </h2>
            <p className={pageStyles.cardDesc}>
              運営が確認中の X ID 連携申請です。承認されると左のタブに表示されます。
            </p>
          </div>
          <PendingLinkRequestList rows={pendingOnly} />
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
              {hasLinkedXIds ? "新しい X ID を連携" : "X ID を連携"}
            </h2>
            <p className={pageStyles.cardDesc}>
              {hasLinkedXIds
                ? "追加の X ID を申請できます。運営（管理者）が目視確認して承認します。"
                : "@ を除いたユーザー名を入力して申請してください。承認後に投稿やプロフィール編集ができます。"}
            </p>
          </div>
          <div className={pageStyles.addBox}>
            <XIdLinkForm
              onSuccessRedirect={
                isOnboarding ? onboardingSuccessHref : next ?? null
              }
            />
          </div>
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
