// MIG-0716 U01a: CURRENT slotted page JSX over a validated initial endpoint response; route remains unregistered.
import * as React from "react";
import { Navigate } from "react-router-dom";
import type { SlottedEntryResponse } from "@flamenode/contracts";
import { VideoForm } from "../../components/forms/VideoForm.js";
import type { VideoFormPorts } from "../../components/forms/videoSubmitAdapter.js";
import { StatusPanel } from "../../components/ui/StatusPanel.js";
import { AuthUnavailable } from "../guard.js";
import { isSafeRelativePath } from "../next.js";
import { AppLink, ExternalRedirect, useDocumentTitle } from "../ui/AppLink.js";
import { formatUnix } from "../ui/format.js";
import { Icon } from "../ui/Icon.js";

// Keep the early guards and direct CURRENT page mapping together so no form mounts before ready validation.
export function Slotted({ data, publicOrigin, ports, onRefresh }: {
  /** The caller owns current access/identity and supplies the initial endpoint response, never a continuation. */
  data: SlottedEntryResponse;
  publicOrigin: string;
  ports: VideoFormPorts;
  onRefresh: () => void;
}): React.ReactElement {
  useDocumentTitle("枠提出");
  if (data.kind === "redirect") {
    let to = "/entry";
    if (isSafeRelativePath(data.to)) {
      try {
        const destination = new URL(data.to, "https://flamenode.invalid");
        const pathname = destination.pathname;
        if (isSafeRelativePath(decodeURIComponent(pathname)) && (pathname === "/entry" || /^\/dashboard\/edit\/[^/]+$/.test(pathname))) {
          to = destination.pathname + destination.search + destination.hash;
        }
      } catch { /* Malformed relative URLs use the existing entry route. */ }
    }
    return to.split(/[?#]/, 1)[0] === "/entry" ? <Navigate to={to} replace /> : <ExternalRedirect to={to} />;
  }
  if (data.truncated || data.nextOffset !== null) return <AuthUnavailable />;
  let origin: string;
  try {
    const configured = new URL(publicOrigin);
    if (configured.protocol !== "http:" && configured.protocol !== "https:") return <AuthUnavailable />;
    origin = configured.origin;
  } catch {
    return <AuthUnavailable />;
  }
  const { user, slot, event: ev, activeXId: activeX, xIdOptions, softwareSuggestions,
    iconCandidates, channelCandidates, slotPart } = data;
  const slotStart = slot.start_time, slotEnd = slot.end_time, groupSize = slot.group_size;
  const reservedAtXId = slot.reserved_at_x_id;
  const nextPath = slot.id ? `/entry/slotted?slot=${encodeURIComponent(slot.id)}` : "/entry/slotted";
  const submitBlockedReason = data.submitBlock === null ? undefined
    : data.submitBlock === "no_active_x"
      ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
      : data.submitBlock === "pending"
        ? "選択中のActive X IDは承認待ちです。承認後に投稿できます。"
        : data.submitBlock === "rejected"
          ? "選択中のActive X IDは却下されています。設定画面で別のX IDを選択してください。"
          : "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。";
  const canPost = !submitBlockedReason;
  const initialProfile = {
    display_name: data.initialProfile.display_name,
    icon_url: data.initialProfile.icon_url ?? undefined,
    profile_text: data.initialProfile.profile_text ?? undefined,
    youtube_channel_url: data.initialProfile.youtube_channel_url ?? undefined,
    other_social_links: data.initialProfile.other_social_links ?? undefined,
  };
  const eventOptions = data.eventOptions.map(option => ({
    ...option, youtube_description_event_url: `${origin}/event/${encodeURIComponent(option.id)}`,
  }));
  const initialEventIds = [ev.id];
  return (
    <div className="fn-public-container fn-page fn-entry-flow">
      <header className="fn-page-head fn-page-head--split entry-slot-page-head">
        <div className="fn-page-head-main">
          <p className="fn-eyebrow">Slot Post</p>
          <h1 className="fn-page-title fn-page-title--compact">枠に作品を提出</h1>
          <p className="fn-page-lead">
            確保済みのイベント枠に作品情報を紐づけます。連続枠の場合も1つの提出として扱います。
          </p>
        </div>
        <div className="fn-page-head-actions">
          <AppLink href={`/event/${ev.id}`} className="fn-btn fn-btn-ghost">
            イベントを見る
          </AppLink>
        </div>
      </header>

      <StatusPanel
        title={canPost ? "投稿前チェック" : "まだ投稿できません"}
        tone={canPost ? "success" : "warning"}
        action={
          !canPost ? (
            <AppLink
              href={`/dashboard/settings?next=${encodeURIComponent(nextPath)}`}
              className="fn-btn fn-btn-primary"
            >
              X ID設定を確認
            </AppLink>
          ) : null
        }
      >
        {canPost
          ? `イベント: ${ev.title} / 投稿者X ID: @${activeX ?? "未設定"} / 連続${groupSize}枠`
          : submitBlockedReason}
      </StatusPanel>

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
            確保名: <strong>{slot.display_name ?? data.activeXName ?? user.name}</strong>
            {" / "}
            取得時 X ID:{" "}
            <strong>
              {reservedAtXId ? `@${reservedAtXId}` : "記録なし"}
            </strong>
            {" / "}
            提出主体: <strong>@{activeX ?? "未設定"}</strong>
          </p>
          {slot.has_reservation_group ? (
            <p className="fn-muted fn-text-sm fn-mt-12">
              この枠は連続取得グループ ({groupSize}連続) に含まれます。提出すると同じ連続枠に同じ作品が紐づきます。
            </p>
          ) : null}
        </div>
      </section>

      <div className="entry-slot-form-shell">
      <VideoForm
        {...ports}
        onRefresh={onRefresh}
        mode="slot"
        draftAuthUserId={user.id}
        slotId={slot.id}
        xIdOptions={xIdOptions}
        activeXId={activeX ?? undefined}
        initial={{
          creator_x_user_id: activeX ?? undefined,
          ...initialProfile,
          event_ids: initialEventIds,
          part: slotPart,
        }}
        defaultProfile={initialProfile}
        softwareSuggestions={softwareSuggestions}
        submitBlockedReason={submitBlockedReason}
        iconCandidates={iconCandidates}
        channelCandidates={channelCandidates}
        eventOptions={eventOptions}
      />
      </div>

      <p className="fn-page-footnote">
        <Icon name="info" size={12} aria-hidden /> 提出した動画は、イベントの
        承認設定によって公開タイミングが変わります。
      </p>
    </div>
  );
}
