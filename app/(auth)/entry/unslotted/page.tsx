import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { requireSession } from "@/lib/auth/guard";
import { getDatabase } from "@/lib/cloudflare";
import {
  events,
  xUserAccountLinks,
  xUsers,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { UnslottedPostForm } from "@/components/forms/UnslottedPostForm";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { getYoutubeChannelCandidates } from "@/lib/db/youtubeChannelCandidates";
import { AppShell } from "@/components/ui/AppShell";
import { StatusPanel } from "@/components/ui/StatusPanel";
import styles from "./page.module.css";
import { fetchActiveCustomQuestionsForEvents } from "@/lib/video/customQuestionAnswers";
import { unslottedEventEligibilityWhere } from "@/lib/video/resolveUnslottedEventSyncTarget";

export const metadata: Metadata = { title: "枠なし投稿" };
export const dynamic = "force-dynamic";

const MAX_UNSLOTTED_EVENT_OPTIONS = 120;

interface Props {
  searchParams?: Promise<{ event_q?: string }>;
}

export default async function UnslottedPostPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/entry/unslotted" });
  if (!guard.ok) return guard.element;

  const user = guard.user;
  const db = getDatabase();
  const activeX = user.active_x_user_id;
  const eventQuery = ((await searchParams)?.event_q ?? "").trim().slice(0, 100);
  const now = Math.floor(Date.now() / 1000);

  const xRow =
    db && activeX
      ? (
          await db
            .select()
            .from(xUsers)
            .where(eq(xUsers.id, activeX))
            .limit(1)
        )[0]
      : null;

  const xIdOptions = db
    ? await db
        .select({ id: xUsers.id, x_name: xUsers.x_name })
        .from(xUserAccountLinks)
        .innerJoin(xUsers, eq(xUserAccountLinks.x_user_id, xUsers.id))
        .where(
          and(
            eq(xUserAccountLinks.auth_user_id, user.id),
            eq(xUsers.approval_status, "approved"),
          )!,
        )
        .orderBy(asc(xUsers.x_name), asc(xUsers.id))
    : [];

  const memberSuggestions = db
    ? await db
        .select({ name: xUsers.x_name, x_user_id: xUsers.id })
        .from(xUsers)
        .orderBy(asc(xUsers.x_name))
        .limit(2000)
    : [];
  const softwareSuggestions = db ? await getUsedSoftwareSuggestions(db) : [];

  const eventOptions = db
    ? await db
        .select({
          id: events.id,
          title: events.title,
          start_time: events.start_time,
          end_time: events.end_time,
          allow_unslotted_posts: events.allow_unslotted_posts,
          parts_json: events.parts_json,
        })
        .from(events)
        .where(
          and(
            unslottedEventEligibilityWhere(now),
            eventQuery
              ? or(
                  like(events.title, `%${eventQuery}%`),
                  like(events.id, `%${eventQuery}%`),
                )
              : undefined,
          )!,
        )
        .orderBy(desc(events.end_time), desc(events.start_time), asc(events.id))
        .limit(MAX_UNSLOTTED_EVENT_OPTIONS)
    : [];

  const questionsByEvent = db
    ? await fetchActiveCustomQuestionsForEvents(
        db,
        eventOptions.map((option) => option.id),
      )
    : new Map();
  const enrichedEventOptions = eventOptions.map((event) => ({
    id: event.id,
    title: event.title,
    parts_json: event.parts_json,
    custom_questions: questionsByEvent.get(event.id) ?? [],
    status_label:
      event.end_time != null && event.end_time <= now
        ? "終了済"
        : "開催前・開催中の個別許可",
  }));

  const iconCandidates =
    db && activeX ? await getXIconCandidates(db, activeX) : [];
  const channelCandidates =
    db && activeX ? await getYoutubeChannelCandidates(db, activeX) : [];

  const activeXIsLinked =
    !activeX || xIdOptions.some((option) => option.id === activeX);
  const submitBlockedReason: string | undefined = !activeX
    ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
    : !activeXIsLinked
      ? "選択中のActive X IDは、このログインユーザーに紐付いていません。設定画面で選び直してください。"
      : xRow?.approval_status !== "approved"
        ? "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。"
        : undefined;
  const canPost = !submitBlockedReason;

  return (
    <AppShell size="default">
      <header className="fn-page-head fn-page-head--split">
        <div className="fn-page-head-main">
          <p className="fn-eyebrow">Unslotted Post</p>
          <h1 className="fn-page-title fn-page-title--compact">作品を投稿する</h1>
          <p className="fn-page-lead">
            通常作品として掲載するか、終了済み・個別許可済みの公開イベント1件へ所属させるかを選択します。
          </p>
        </div>
        <div className="fn-page-head-actions">
          <Link href="/entry" className="fn-btn fn-btn-ghost">
            投稿方法を選択
          </Link>
        </div>
      </header>

      <StatusPanel
        title={canPost ? "投稿前チェック" : "まだ投稿できません"}
        tone={canPost ? "success" : "warning"}
        action={
          !canPost ? (
            <Link
              href={`/dashboard/settings?next=${encodeURIComponent("/entry/unslotted")}`}
              className="fn-btn fn-btn-primary"
            >
              X ID設定を確認
            </Link>
          ) : null
        }
      >
        {canPost
          ? `投稿者X ID: @${activeX} / 表示名: ${xRow?.x_name ?? user.name ?? "未設定"}`
          : submitBlockedReason}
      </StatusPanel>

      <form method="get" role="search" className={styles.eventSearchForm}>
        <label
          className={`fn-label ${styles.eventSearchLabel}`}
          htmlFor="unslotted_event_search"
        >
          所属先イベントを検索
        </label>
        <input
          id="unslotted_event_search"
          name="event_q"
          type="search"
          defaultValue={eventQuery}
          className={`fn-input ${styles.eventSearchInput}`}
          placeholder="イベント名またはID"
          maxLength={100}
        />
        <button type="submit" className="fn-btn fn-btn-ghost">
          <Icon name="search" size={12} aria-hidden /> 検索
        </button>
        {eventQuery ? (
          <Link href="/entry/unslotted" className="fn-btn fn-btn-ghost">
            解除
          </Link>
        ) : null}
        <span className={`fn-muted ${styles.eventSearchMeta}`}>
          {eventQuery
            ? `「${eventQuery}」の候補 ${eventOptions.length}件`
            : `直近の候補 ${eventOptions.length}件（過去分は検索）`}
        </span>
      </form>

      <UnslottedPostForm
        xIdOptions={xIdOptions}
        activeXId={activeX ?? undefined}
        initial={{
          creator_x_user_id: activeX ?? undefined,
          display_name: xRow?.x_name ?? user.name,
          icon_url: xRow?.icon_url ?? user.image ?? undefined,
          profile_text: xRow?.profile_text ?? undefined,
          youtube_channel_url: xRow?.youtube_channel_url ?? undefined,
          other_social_links: xRow?.other_social_links ?? undefined,
        }}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
        submitBlockedReason={submitBlockedReason}
        iconCandidates={iconCandidates}
        channelCandidates={channelCandidates}
        eventOptions={enrichedEventOptions}
      />

      <p className="fn-page-footnote">
        <Icon name="info" size={12} aria-hidden />
        利用規約への再同意は提出時に確認します。
      </p>
    </AppShell>
  );
}
