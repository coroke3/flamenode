import * as React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { VideoForm } from "@/components/forms/VideoForm";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { getYoutubeChannelCandidates } from "@/lib/db/youtubeChannelCandidates";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { loadStagePermissionFormSettingsJsonByEvents } from "@/lib/video/stagePermissionQuestions";
import { AppShell } from "@/components/ui/AppShell";
import { StatusPanel } from "@/components/ui/StatusPanel";

export const metadata: Metadata = { title: "枠提出" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ slot?: string }>;
}

export default async function SlottedPostPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { slot: slotId = "" } = await searchParams;
  // ログイン誘導後に slot 付きの URL に戻れるように next を組み立てる。
  const nextPath = slotId
    ? `/entry/slotted?slot=${encodeURIComponent(slotId)}`
    : "/entry/slotted";
  const guard = await requireSession({ next: nextPath });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();
  if (!slotId) redirect("/entry");
  const activeXId = user.active_x_user_id ?? null;
  const slotOwnerWhere = activeXId
    ? or(
        eq(slotsTable.x_user_id, activeXId),
        and(isNull(slotsTable.x_user_id), eq(slotsTable.discord_user_id, user.id))!,
      )
    : eq(slotsTable.discord_user_id, user.id);
  const rows = await db
    .select()
    .from(slotsTable)
    .where(and(eq(slotsTable.id, slotId), slotOwnerWhere)!)
    .limit(1);
  const slot = rows[0];
  if (!slot) notFound();
  if (slot.status === "submitted" && slot.video_id) {
    redirect(`/dashboard/edit/${slot.video_id}`);
  }
  if (slot.status !== "reserved") redirect("/entry");
  if (slot.x_user_id && activeXId && slot.x_user_id !== activeXId) {
    redirect("/entry");
  }
  const ev = (
    await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, slot.event_id))
      .limit(1)
  )[0];
  if (!ev) notFound();
  let slotStart = slot.start_time;
  let slotEnd = slot.start_time;
  let groupSize = 1;
  if (slot.reservation_group_id) {
    const groupRows = await db
      .select({ start_time: slotsTable.start_time })
      .from(slotsTable)
      .where(eq(slotsTable.reservation_group_id, slot.reservation_group_id));
    if (groupRows.length > 0) {
      groupSize = groupRows.length;
      const starts = groupRows
        .map((r) => r.start_time)
        .filter((v): v is number => typeof v === "number");
      const ends = groupRows
        .map((r) => r.start_time)
        .filter((v): v is number => typeof v === "number");
      if (starts.length > 0) slotStart = Math.min(...starts);
      if (ends.length > 0) slotEnd = Math.max(...ends);
    }
  }
  const activeX = slot.x_user_id ?? activeXId;
  const xRow = activeX
    ? (
        await db
          .select()
          .from(xUsersTable)
          .where(eq(xUsersTable.id, activeX))
          .limit(1)
      )[0]
    : null;
  const xIdOptions = await db
    .select({ id: xUsersTable.id, x_name: xUsersTable.x_name })
    .from(xUsersTable)
    .where(
      and(
        eq(xUsersTable.linked_discord_user_id, user.id),
        eq(xUsersTable.approval_status, "approved"),
      )!,
    )
    .orderBy(asc(xUsersTable.x_name));
  const memberSuggestions = await db
    .select({ name: xUsersTable.x_name, x_user_id: xUsersTable.id })
    .from(xUsersTable)
    .orderBy(asc(xUsersTable.x_name))
    .limit(2000);
  const softwareSuggestions = await getUsedSoftwareSuggestions(db);
  const iconCandidates = activeX ? await getXIconCandidates(db, activeX) : [];
  const channelCandidates =
    activeX && db ? await getYoutubeChannelCandidates(db, activeX) : [];
  // 所属イベント候補: 「許可フラグ付き」かつ受付中のイベント + スロットのイベント (常時固定)。
  const acceptingEvents = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.visibility_status, "public"))
    .then((rows) =>
      rows
        .filter(
          (event) =>
            isAcceptingEntries(event) &&
            event.allow_user_video_event_links === 1,
        )
        .map((event) => ({
          id: event.id,
          title: event.title,
          parts_json: event.parts_json,
        })),
    );
  const slotEventOption = {
    id: ev.id,
    title: ev.title,
    parts_json: ev.parts_json,
  };
  const rawEventOptions = acceptingEvents.some((o) => o.id === ev.id)
    ? acceptingEvents
    : [slotEventOption, ...acceptingEvents];
  const formSettingsByEvent = await loadStagePermissionFormSettingsJsonByEvents(
    db,
    rawEventOptions.map((option) => option.id),
  );
  const eventOptions = rawEventOptions.map((option) => ({
    ...option,
    video_form_settings_json: formSettingsByEvent.get(option.id) ?? null,
  }));
  const initialEventIds = [ev.id];

  // 投稿は writeGuard で active_x_user_id が approved であることを要求するため、
  // フォーム送信前に同じ条件を判定して「押せるけど失敗する」状態を防ぐ。
  // 注: writeGuard は session の active_x_user_id を見るため、ここでは activeXId
  // (= user.active_x_user_id) の有無もブロック条件にする (slot.x_user_id だけでは不可)。
  const activeXApprovalStatus = xRow?.approval_status ?? null;
  const submitBlockedReason: string | undefined = !activeXId
    ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
    : activeXApprovalStatus === "pending"
      ? "選択中のActive X IDは承認待ちです。承認後に投稿できます。"
      : activeXApprovalStatus === "rejected"
        ? "選択中のActive X IDは却下されています。設定画面で別のX IDを選択してください。"
        : activeXApprovalStatus !== "approved"
          ? "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。"
          : undefined;
  const canPost = !submitBlockedReason;

  return (
    <AppShell size="default">
      <header className="fn-page-head fn-page-head--split">
        <div className="fn-page-head-main">
          <p className="fn-eyebrow">Slot Post</p>
          <h1 className="fn-page-title fn-page-title--compact">枠に作品を提出</h1>
          <p className="fn-page-lead">
            確保済みのイベント枠に作品情報を紐づけます。連続枠の場合も1つの提出として扱います。
          </p>
        </div>
        <div className="fn-page-head-actions">
          <Link href={`/event/${ev.id}`} className="fn-btn fn-btn-ghost">
            イベントを見る
          </Link>
        </div>
      </header>

      <StatusPanel
        title={canPost ? "投稿前チェック" : "まだ投稿できません"}
        tone={canPost ? "success" : "warning"}
        action={
          !canPost ? (
            <Link
              href={`/dashboard/settings?next=${encodeURIComponent(nextPath)}`}
              className="fn-btn fn-btn-primary"
            >
              X ID設定を確認
            </Link>
          ) : null
        }
      >
        {canPost
          ? `イベント: ${ev.title} / 投稿者X ID: @${activeX ?? "未設定"} / 連続枠: ${groupSize}`
          : submitBlockedReason}
      </StatusPanel>

      <section className="fn-card fn-highlight-card fn-card-accent">
        <div className="fn-card-body">
          <p className="fn-highlight-card-kicker">確保済み枠</p>
          <h2 className="fn-highlight-card-title">
            {slotStart ? (
              <>
                {formatUnix(slotStart, { dateOnly: true })}{" "}
                {formatUnix(slotStart, { timeOnly: true })}
                {slotEnd != null && slotEnd > slotStart
                  ? ` - ${formatUnix(slotEnd, { timeOnly: true })}`
                  : ""}
              </>
            ) : (
              slot.slot_label ?? "時間指定なし枠"
            )}
          </h2>
          <p className="fn-highlight-card-lead">
            確保名: <strong>{slot.display_name ?? xRow?.x_name ?? user.name}</strong>
            {" / "}
            提出主体: <strong>@{activeX ?? "未設定"}</strong>
          </p>
          {slot.reservation_group_id ? (
            <p className="fn-muted fn-text-sm fn-mt-12">
              この枠は連続取得グループ ({groupSize}連続) に含まれます。提出すると同じ連続枠に同じ作品が紐づきます。
            </p>
          ) : null}
        </div>
      </section>

      <VideoForm
        mode="slot"
        slotId={slot.id}
        slotInfo={{
          eventTitle: ev.title,
          slotTimeLabel: slotStart
            ? `${formatUnix(slotStart, { dateOnly: true })} ${formatUnix(slotStart, { timeOnly: true })}${
                slotEnd != null && slotEnd > slotStart
                  ? ` - ${formatUnix(slotEnd, { timeOnly: true })}`
                  : ""
              }`
            : (slot.slot_label ?? "時間指定なし枠"),
          displayName: slot.display_name ?? xRow?.x_name ?? user.name,
          groupSize: groupSize > 1 ? groupSize : undefined,
        }}
        xIdOptions={xIdOptions}
        activeXId={activeX ?? undefined}
        initial={{
          creator_x_user_id: activeX ?? undefined,
          display_name: slot.display_name ?? xRow?.x_name ?? user.name,
          icon_url: xRow?.icon_url ?? user.image ?? undefined,
          profile_text: xRow?.profile_text ?? undefined,
          youtube_channel_url: xRow?.youtube_channel_url ?? undefined,
          other_social_links: xRow?.other_social_links ?? undefined,
          event_ids: initialEventIds,
        }}
        memberSuggestions={memberSuggestions}
        softwareSuggestions={softwareSuggestions}
        submitBlockedReason={submitBlockedReason}
        iconCandidates={iconCandidates}
        channelCandidates={channelCandidates}
        eventOptions={eventOptions}
      />

      <p className="fn-page-footnote">
        <Icon name="info" size={12} aria-hidden /> 提出した動画は、イベントの
        承認設定によって公開タイミングが変わります。
      </p>
    </AppShell>
  );
}
