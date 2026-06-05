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
  XIdLinkedList,
  type PendingLinkRequestRow,
  type SettingsXIdRow,
} from "@/components/settings/XIdLinkedList";
import { SettingsStatusPill } from "@/components/settings/SettingsStatusPill";
import pageStyles from "@/components/settings/settings-page.module.css";
import { sanitizeNextPath } from "#utils/next";
import { getXIconCandidates } from "@/lib/db/xIconResolution";

export const metadata: Metadata = { title: "設定" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
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
        .where(eq(xUsersTable.linked_discord_user_id, user.id))
    : [];

  const pendingLinkRequests = db
    ? await db
        .select()
        .from(linkReqTable)
        .where(
          and(
            eq(linkReqTable.discord_user_id, user.id),
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
  if (db && xIds.length > 0) {
    for (const x of xIds) {
      iconCandidatesById[x.id] = await getXIconCandidates(db, x.id, 12);
    }
  }

  const activeX =
    user.active_x_user_id != null
      ? xIds.find((x) => x.id === user.active_x_user_id)
      : null;
  const activeApproved =
    activeX?.approval_status === "approved" ? activeX : null;

  return (
    <div className={`fn-public-container fn-page ${pageStyles.wrap}`}>
      <header className={`fn-page-head ${pageStyles.hd}`}>
        <Link href="/dashboard" className={pageStyles.back}>
          ← ダッシュボード
        </Link>
        <h1 className="fn-display fn-page-title">設定</h1>
        <p className="fn-page-lead">
          X ID 連携、アクティブ X ID の切替、Discord アカウント情報を管理します。
        </p>
        {next ? (
          <div className={pageStyles.nextRow}>
            <Link href={next} className="fn-btn fn-btn-primary fn-btn-sm">
              <Icon name="chevron-right" size={13} aria-hidden />
              元の画面へ戻る
            </Link>
          </div>
        ) : null}
      </header>

      <section
        className={`${pageStyles.card} ${pageStyles.cardAccent}`}
        aria-labelledby="settings-active-h"
      >
        <div className={pageStyles.cardHd}>
          <h2
            id="settings-active-h"
            className={`${pageStyles.cardTitle} ${pageStyles.cardTitleAccent}`}
          >
            アクティブ X ID
          </h2>
          <p className={pageStyles.cardDesc}>
            ダッシュボード・作品クレジット・スロット表示に使われる名義です。
          </p>
        </div>
        {activeApproved ? (
          <div className={pageStyles.activePanel}>
            {activeApproved.icon_url ? (
              <span className={pageStyles.avatar} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeApproved.icon_url}
                  alt=""
                  className={pageStyles.avatarImg}
                />
              </span>
            ) : (
              <span className={pageStyles.avatar} aria-hidden="true">
                {activeApproved.id.charAt(0).toUpperCase()}
              </span>
            )}
            <div className={pageStyles.activeId}>
              <span className={pageStyles.activeName}>
                {activeApproved.x_name || activeApproved.id}
              </span>
              <span className={pageStyles.activeHandle}>
                <Icon name="x" size={11} aria-hidden />@{activeApproved.id}
              </span>
            </div>
            <div className={pageStyles.activeBadges}>
              <span className="fn-badge fn-badge-accent">アクティブ</span>
              <SettingsStatusPill status="approved" />
            </div>
          </div>
        ) : (
          <div className={pageStyles.activePanel}>
            <p className={pageStyles.activePanelEmpty}>
              {activeX && activeX.approval_status !== "approved"
                ? "承認済みの X ID をアクティブに設定してください。"
                : "承認済みの X ID を連携し、アクティブに設定してください。"}
            </p>
          </div>
        )}
      </section>

      <section className={pageStyles.card} aria-labelledby="settings-linked-h">
        <div className={`${pageStyles.cardHd} ${pageStyles.cardHdBordered}`}>
          <h2 id="settings-linked-h" className={pageStyles.cardTitle}>
            連携 X ID
          </h2>
          <p className={pageStyles.cardDesc}>
            複数の X ID を連携できます。投稿や枠確保の名義はアクティブ X ID が使われます。
          </p>
        </div>

        <XIdLinkedList
          xIds={xIds}
          activeXUserId={user.active_x_user_id}
          iconCandidatesById={iconCandidatesById}
          next={next}
        />
        <PendingLinkRequestList rows={pendingOnly} />

        <div className={pageStyles.addBox}>
          <span className={pageStyles.addLabel}>新しい X ID を申請</span>
          <XIdLinkForm compact />
          <p className={pageStyles.addHint}>
            申請後は運営（管理者）が目視確認して承認します。
          </p>
        </div>
      </section>

      <section className={pageStyles.card} aria-labelledby="settings-discord-h">
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
    </div>
  );
}
