import * as React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { getLinkedXUsersForAuthUser } from "@/lib/auth/xIdentity";
import { VideoForm } from "@/components/forms/VideoForm";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { getUsedSoftwareSuggestions } from "@/lib/db/videoFormSuggestions";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { getYoutubeChannelCandidates } from "@/lib/db/youtubeChannelCandidates";
import { isAcceptingEntries } from "@/lib/utils/eventStatus";
import { loadStagePermissionFormSettingsJsonByEvents } from "@/lib/video/stagePermissionQuestions";
import { MAX_ATOMIC_SLOT_ROWS } from "@/lib/slots/atomicLimits";
import {
  resolveSlotViewerRelation,
} from "@/lib/slots/slotIdentityCore";
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
  const nextPath = slotId
    ? `/entry/slotted?slot=${encodeURIComponent(slotId)}`
    : "/entry/slotted";
  const guard = await requireSession({ next: nextPath });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();
  if (!slotId) redirect("/entry");

  const rows = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.id, slotId))
    .limit(1);
  const slot = rows[0];
  if (!slot) notFound();

  const currentActiveXId = user.active_x_user_id ?? null;
  const reservedXId = slot.x_user_id ?? null;
  const viewerRelation = resolveSlotViewerRelation({
    reservedByUserId: slot.reserved_by_user_id,
    slotXUserId: slot.x_user_id,
    authUserId: user.id,
    activeXId: currentActiveXId,
  });

  if (viewerRelation === "none") notFound();

  if (slot.status === "submitted" && slot.video_id) {
    redirect(`/dashboard/edit/${slot.video_id}`);
  }
  if (
    viewerRelation === "active" || viewerRelation === "unassigned"
  ) {
    if (slot.status !== "reserved") redirect("/entry");
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
  let groupIntegrityError = false;
  if (slot.reservation_group_id) {
    const groupRows = await db
      .select({ start_time: slotsTable.start_time })
      .from(slotsTable)
      .where(
        and(
          eq(slotsTable.reservation_group_id, slot.reservation_group_id),
          eq(slotsTable.event_id, slot.event_id),
        )!,
      )
      .limit(MAX_ATOMIC_SLOT_ROWS + 1);
    if (groupRows.length > MAX_ATOMIC_SLOT_ROWS) {
      groupIntegrityError = true;
    } else if (groupRows.length > 0) {
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

  const linkedApprovedXUsers = await getLinkedXUsersForAuthUser(db, user.id, {
    approvedOnly: true,
  });
  const reservedXLinkedApproved =
    reservedXId !== null &&
    linkedApprovedXUsers.some((row) => row.x_user_id === reservedXId);

  const effectiveSubmissionXId =
    viewerRelation === "active"
      ? reservedXId ?? currentActiveXId
      : viewerRelation === "unassigned"
        ? currentActiveXId
        : null;

  const showForm =
    !groupIntegrityError &&
    (viewerRelation === "active" || viewerRelation === "unassigned") &&
    effectiveSubmissionXId !== null;

  let xRow: typeof xUsersTable.$inferSelect | null = null;
  let xIdOptions: Array<{ id: string; x_name: string }> = [];
  let memberSuggestions: Array<{ name: string; x_user_id: string }> = [];
  let softwareSuggestions: string[] = [];
  let iconCandidates: Awaited<ReturnType<typeof getXIconCandidates>> = [];
  let channelCandidates: Awaited<ReturnType<typeof getYoutubeChannelCandidates>> = [];
  let eventOptions: Array<{
    id: string;
    title: string;
    parts_json: string | null;
    video_form_settings_json: string | null;
  }> = [];
  let initialEventIds: string[] = [];
  let submitBlockedReason: string | undefined;
  let canPost = false;
  let initialProfile:
    | {
        display_name: string | undefined;
        icon_url: string | undefined;
        profile_text: string | undefined;
        youtube_channel_url: string | undefined;
        other_social_links: string | undefined;
      }
    | undefined;

  if (showForm && effectiveSubmissionXId) {
    xRow = (
      await db
        .select()
        .from(xUsersTable)
        .where(eq(xUsersTable.id, effectiveSubmissionXId))
        .limit(1)
    )[0] ?? null;

    xIdOptions = linkedApprovedXUsers
      .map((row) => ({ id: row.x_user_id, x_name: row.x_name }))
      .sort((a, b) => a.x_name.localeCompare(b.x_name, "ja"));
    memberSuggestions = await db
      .select({ name: xUsersTable.x_name, x_user_id: xUsersTable.id })
      .from(xUsersTable)
      .orderBy(asc(xUsersTable.x_name))
      .limit(2000);
    softwareSuggestions = await getUsedSoftwareSuggestions(db);
    iconCandidates = await getXIconCandidates(db, effectiveSubmissionXId);
    channelCandidates = await getYoutubeChannelCandidates(db, effectiveSubmissionXId);

    const acceptingEvents = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.visibility_status, "public"))
      .then((eventRows) =>
        eventRows
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
    eventOptions = rawEventOptions.map((option) => ({
      ...option,
      video_form_settings_json: formSettingsByEvent.get(option.id) ?? null,
    }));
    initialEventIds = [ev.id];

    const activeXApprovalStatus = xRow?.approval_status ?? null;
    submitBlockedReason = !currentActiveXId
      ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
      : activeXApprovalStatus === "pending"
        ? "選択中のActive X IDは承認待ちです。承認後に投稿できます。"
        : activeXApprovalStatus === "rejected"
          ? "選択中のActive X IDは却下されています。設定画面で別のX IDを選択してください。"
          : activeXApprovalStatus !== "approved"
            ? "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。"
            : undefined;
    canPost = !submitBlockedReason;

    initialProfile = {
      display_name: slot.display_name ?? xRow?.x_name ?? user.name ?? undefined,
      icon_url: xRow?.icon_url ?? user.image ?? undefined,
      profile_text: xRow?.profile_text ?? undefined,
      youtube_channel_url: xRow?.youtube_channel_url ?? undefined,
      other_social_links: xRow?.other_social_links ?? undefined,
    };
  }

  const slotSummaryName =
    slot.display_name ?? xRow?.x_name ?? user.name ?? "未設定";
  const submissionHandleLabel = effectiveSubmissionXId
    ? `@${effectiveSubmissionXId}`
    : "未設定";

  return (
    <AppShell size="default">
      <header className="fn-page-head fn-page-head--split entry-slot-page-head">
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

      {viewerRelation === "account_other" ? (
        reservedXLinkedApproved && currentActiveXId && reservedXId ? (
          <StatusPanel
            title="活動名義が一致していません"
            tone="warning"
            action={
              <Link
                href={`/dashboard/settings?next=${encodeURIComponent(nextPath)}`}
                className="fn-btn fn-btn-primary"
              >
                Active X ID を切り替え
              </Link>
            }
          >
            この枠は @{reservedXId} で確保されています。現在の Active X ID は
            @{currentActiveXId} です。提出するには Active X ID を枠確保時の名義に
            切り替えてください。
          </StatusPanel>
        ) : (
          <StatusPanel title="枠の状態を確認できませんでした" tone="warning">
            この枠の活動名義を確認できませんでした。画面を更新するか、運営にお問い合わせください。
          </StatusPanel>
        )
      ) : groupIntegrityError ? (
        <StatusPanel title="枠の状態を確認できませんでした" tone="warning">
          連続枠の件数が想定上限を超えています。運営にお問い合わせください。
        </StatusPanel>
      ) : showForm ? (
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
            ? `イベント: ${ev.title} / 投稿者X ID: ${submissionHandleLabel} / 連続枠: ${groupSize}`
            : submitBlockedReason}
        </StatusPanel>
      ) : viewerRelation === "unassigned" && !effectiveSubmissionXId ? (
        <StatusPanel
          title="まだ投稿できません"
          tone="warning"
          action={
            <Link
              href={`/dashboard/settings?next=${encodeURIComponent(nextPath)}`}
              className="fn-btn fn-btn-primary"
            >
              X ID設定を確認
            </Link>
          }
        >
          投稿には Active X ID の選択が必要です。設定画面から連携・選択してください。
        </StatusPanel>
      ) : null}

      <section className="fn-card fn-highlight-card fn-card-accent entry-slot-summary">
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
            確保名: <strong>{slotSummaryName}</strong>
            {showForm ? (
              <>
                {" / "}
                提出主体: <strong>{submissionHandleLabel}</strong>
              </>
            ) : null}
          </p>
          {slot.reservation_group_id && !groupIntegrityError ? (
            <p className="fn-muted fn-text-sm fn-mt-12">
              この枠は連続取得グループ ({groupSize}連続) に含まれます。提出すると同じ連続枠に同じ作品が紐づきます。
            </p>
          ) : null}
        </div>
      </section>

      {showForm && initialProfile ? (
        <div className="entry-slot-form-shell">
          <VideoForm
            key={`slotted:${slot.id}:${currentActiveXId ?? "unassigned"}`}
            mode="slot"
            slotId={slot.id}
            xIdOptions={xIdOptions}
            activeXId={effectiveSubmissionXId ?? undefined}
            activeXSnapshot={currentActiveXId}
            initial={{
              creator_x_user_id: effectiveSubmissionXId ?? undefined,
              ...initialProfile,
              event_ids: initialEventIds,
            }}
            defaultProfile={initialProfile}
            memberSuggestions={memberSuggestions}
            softwareSuggestions={softwareSuggestions}
            submitBlockedReason={submitBlockedReason}
            iconCandidates={iconCandidates}
            channelCandidates={channelCandidates}
            eventOptions={eventOptions}
          />
        </div>
      ) : null}

      {showForm ? (
        <p className="fn-page-footnote">
          <Icon name="info" size={12} aria-hidden /> 提出した動画は、イベントの
          承認設定によって公開タイミングが変わります。
        </p>
      ) : null}
    </AppShell>
  );
}
