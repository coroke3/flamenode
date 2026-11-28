// MIG-0716 U01a: CURRENT ordinary-post page over a validated initial response; trusted host remains U01b.
import * as React from "react";
import type { UnslottedEntryResponse } from "@flamenode/contracts";
import { UnslottedPostForm } from "../../components/forms/UnslottedPostForm.js";
import type { VideoFormPorts } from "../../components/forms/videoSubmitAdapter.js";
import { StatusPanel } from "../../components/ui/StatusPanel.js";
import { AuthUnavailable } from "../guard.js";
import { AppLink, useDocumentTitle } from "../ui/AppLink.js";
import { Icon } from "../ui/Icon.js";

// Keep the initial-snapshot guard beside CURRENT composition; the caller, not these flags, proves provenance.
export function Unslotted({ data, publicOrigin, ports, onRefresh }: {
  /** Current identity/query's access-checked initial endpoint response, not an arbitrary terminal page. */
  data: UnslottedEntryResponse;
  publicOrigin: string;
  ports: VideoFormPorts;
  onRefresh: () => void;
}): React.ReactElement {
  useDocumentTitle("枠なし投稿");
  if (data.truncated || data.nextOffset !== null) return <AuthUnavailable />;
  let origin: string;
  try {
    const configured = new URL(publicOrigin);
    if (configured.protocol !== "http:" && configured.protocol !== "https:") return <AuthUnavailable />;
    origin = configured.origin;
  } catch {
    return <AuthUnavailable />;
  }
  const { user, activeXId: activeX, xIdOptions, softwareSuggestions, iconCandidates,
    channelCandidates, eventOptions, eventQuery } = data;
  const submitBlockedReason = data.submitBlock === null ? undefined
    : data.submitBlock === "no_active_x"
      ? "投稿にはActive X IDの選択が必要です。設定画面から連携・選択してください。"
      : data.submitBlock === "not_linked"
        ? "選択中のActive X IDは、このログインユーザーに紐付いていません。設定画面で選び直してください。"
        : "投稿には承認済みのActive X IDが必要です。設定画面で承認状態を確認してください。";
  const canPost = !submitBlockedReason;
  const initialProfile = {
    display_name: data.initialProfile.display_name,
    icon_url: data.initialProfile.icon_url ?? undefined,
    profile_text: data.initialProfile.profile_text ?? undefined,
    youtube_channel_url: data.initialProfile.youtube_channel_url ?? undefined,
    other_social_links: data.initialProfile.other_social_links ?? undefined,
  };
  const enrichedEventOptions = eventOptions.map(option => ({
    ...option, youtube_description_event_url: `${origin}/event/${encodeURIComponent(option.id)}`,
  }));
  return (
    <div className="fn-public-container fn-page fn-entry-flow">
      <header className="fn-page-head fn-page-head--split">
        <div className="fn-page-head-main">
          <p className="fn-eyebrow">Unslotted Post</p>
          <h1 className="fn-page-title fn-page-title--compact">作品を投稿する</h1>
          <p className="fn-page-lead">
            通常作品として掲載するか、終了済み・個別許可済みの公開イベント1件へ所属させるかを選択します。
          </p>
        </div>
        <div className="fn-page-head-actions">
          <AppLink href="/entry" className="fn-btn fn-btn-ghost">
            投稿方法を選択
          </AppLink>
        </div>
      </header>

      <StatusPanel
        title={canPost ? "投稿前チェック" : "まだ投稿できません"}
        tone={canPost ? "success" : "warning"}
        action={
          !canPost ? (
            <AppLink
              href={`/dashboard/settings?next=${encodeURIComponent("/entry/unslotted")}`}
              className="fn-btn fn-btn-primary"
            >
              X ID設定を確認
            </AppLink>
          ) : null
        }
      >
        {canPost
          ? `投稿者X ID: @${activeX} / 表示名: ${initialProfile.display_name}`
          : submitBlockedReason}
      </StatusPanel>

      <form method="get" role="search" className={`entry-unslotted-eventSearchForm fn-entry-search`}>
        <label
          className={`fn-label entry-unslotted-eventSearchLabel`}
          htmlFor="unslotted_event_search"
        >
          所属先イベントを検索
        </label>
        <input
          id="unslotted_event_search"
          name="event_q"
          type="search"
          defaultValue={eventQuery}
          className={`fn-input entry-unslotted-eventSearchInput`}
          placeholder="イベント名またはID"
          maxLength={100}
        />
        <button type="submit" className="fn-btn fn-btn-ghost">
          <Icon name="search" size={12} aria-hidden /> 検索
        </button>
        {eventQuery ? (
          <AppLink href="/entry/unslotted" className="fn-btn fn-btn-ghost">
            解除
          </AppLink>
        ) : null}
        <span className={`fn-muted entry-unslotted-eventSearchMeta`}>
          {eventQuery
            ? `「${eventQuery}」の候補 ${eventOptions.length}件`
            : `直近の候補 ${eventOptions.length}件（過去分は検索）`}
        </span>
      </form>

      <UnslottedPostForm
        {...ports}
        onRefresh={onRefresh}
        draftAuthUserId={user.id}
        xIdOptions={xIdOptions}
        activeXId={activeX ?? undefined}
        initial={{
          creator_x_user_id: activeX ?? undefined,
          ...initialProfile,
        }}
        defaultProfile={initialProfile}
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
    </div>
  );
}
