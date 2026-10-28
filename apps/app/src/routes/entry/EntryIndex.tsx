import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { EntryIndexResponse } from "@flamenode/contracts";
import type { PersonalApi } from "../../api/personal.js";
import { AuthUnavailable, BannedNotice, SessionLoading, useApiResult } from "../guard.js";
import { onboardingHref, sanitizeNextPath } from "../next.js";
import { AppLink, useDocumentTitle } from "../ui/AppLink.js";
import { formatUnix } from "../ui/format.js";
import { Icon } from "../ui/Icon.js";
import { startDiscordSignIn } from "./discordSignIn.js";

// CURRENT app/(auth)/entry/page.tsx:28-43. Keep the externally observable OAuth error copy.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_check_failed: "ログイン確認の有効期限が切れました。もう一度 Discord でログインしてください。",
  AccessDenied: "Discord認証がキャンセルされました",
  OAuthCallback: "Discord認証を完了できませんでした",
  OAuthCallbackError: "Discord認証を完了できませんでした",
  OAuthSignin: "Discord認証を開始できませんでした",
  OAuthCreateAccount: "アカウント作成に失敗しました",
  Callback: "Discord認証を完了できませんでした",
  AccountNotLinked: "このDiscordアカウントは別のユーザーに紐付いています",
  OAuthAccountNotLinked: "同じメールのアカウントが既にあります。もう一度ログインすると紐付けを完了できます",
  Configuration: "ログイン処理中にエラーが発生しました。時間をおいて再度お試しください。",
  auth_temporarily_unavailable: "認証基盤が一時的に利用できません",
  Verification: "認証リンクの検証に失敗しました",
  Default: "認証を完了できませんでした",
};

export function authErrorMessage(code: string | null): string | null {
  return code ? AUTH_ERROR_MESSAGES[code] ?? AUTH_ERROR_MESSAGES.Default : null;
}

/** The /entry endpoint returns 401 to guests; this route is itself the login entrance. */
export function EntryIndex({ api }: { api: PersonalApi }): React.ReactElement {
  useDocumentTitle("エントリー / 投稿");
  const [params] = useSearchParams();
  const next = sanitizeNextPath(params.get("next"), "/entry");
  const authError = authErrorMessage(params.get("error"));
  const result = useApiResult(api, "entry-index", (client, signal) => client.getEntryIndex(signal));
  if (result.status === "loading") return <SessionLoading />;
  if (result.status === "unavailable") return <AuthUnavailable />;
  if (result.status === "banned" || (result.status === "ok" && result.data.user.is_banned === 1)) {
    return <BannedNotice />;
  }
  return <EntryIndexView data={result.status === "ok" ? result.data : null} next={next} authError={authError} />;
}

export function EntryIndexView({
  data,
  next,
  authError,
}: {
  data: EntryIndexResponse | null;
  next: string;
  authError: string | null;
}): React.ReactElement {
  const [signInPending, setSignInPending] = React.useState(false);
  const loggedIn = data !== null;
  const onboardingNext = onboardingHref(next);
  const resolveSlotHref = (target: string): string => {
    if (!data) return `/entry?next=${encodeURIComponent(target)}`;
    if (!data.state.canReserveSlot) return onboardingHref(target);
    return target;
  };
  const resolvePostHref = (target: string): string => {
    if (!data) return `/entry?next=${encodeURIComponent(target)}`;
    if (!data.state.canReserveSlot || !data.state.canPost) return onboardingHref(target);
    return target;
  };
  const writeCtaLabel = (defaultLabel: string): string => {
    if (!data) return defaultLabel;
    if (!data.state.canReserveSlot) return "初期設定を続ける";
    if (!data.state.canPost) return data.data.state.xIdentityStatus === "pending" ? "承認待ち" : "X ID 連携が必要";
    return defaultLabel;
  };
  const startSignIn = (): void => {
    if (signInPending) return;
    setSignInPending(true);
    void startDiscordSignIn(next);
  };

  return (
    <div className="fn-public-container fn-page fn-entry">
      <header className="fn-page-head">
        <span className="fn-eyebrow">entry</span>
        <h1 className="fn-display fn-page-title">参加・投稿</h1>
        <p className="fn-jp fn-page-lead">
          イベント参加、確保済み枠への提出、通常投稿をここから始められます。
        </p>
      </header>

      {!data ? (
        <section className="fn-entry-status fn-entry-status--warn">
          <div className="fn-entry-status-body">
            <h2 className="fn-jp fn-panel-title">まず Discord でログインしてください</h2>
            <p className="fn-jp fn-entry-status-lead">参加・投稿にはログインと初期設定が必要です。</p>
            {authError ? <p className="fn-jp fn-entry-status-lead" role="alert">{authError}</p> : null}
            <div className="entry-btnRow">
              <button type="button" className="fn-btn fn-btn-primary"
                disabled={signInPending} aria-busy={signInPending} onClick={startSignIn}>
                <Icon name="discord" size={14} aria-hidden /> Discord でログイン
              </button>
            </div>
          </div>
        </section>
      ) : !data.state.canReserveSlot ? (
        <div className="fn-entry-status fn-entry-status--warn" role="status">
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h2 className="fn-jp fn-panel-title">初期設定が未完了です</h2>
            <p className="fn-jp fn-entry-status-lead">利用規約への同意を完了してください。</p>
            <AppLink href={onboardingNext} className="fn-btn fn-btn-primary fn-mt-12">初期設定を続ける</AppLink>
          </div>
        </div>
      ) : !data.state.canPost ? (
        <div className="fn-entry-status fn-entry-status--warn" role="status">
          <Icon name={state.xIdentityStatus === "pending" ? "clock" : "alert"} size={18} aria-hidden />
          <div>
            {state.xIdentityStatus === "pending" ? (
              <>
                <h2 className="fn-jp fn-panel-title">X ID 承認待ち</h2>
                <p className="fn-jp fn-entry-status-lead">枠確保は可能です。投稿は X ID 承認後に利用できます。</p>
              </>
            ) : (
              <>
                <h2 className="fn-jp fn-panel-title">作品投稿には X ID 連携が必要</h2>
                <p className="fn-jp fn-entry-status-lead">枠確保は可能です。投稿は X ID の承認後に利用できます。</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="fn-entry-status fn-entry-status--ok">
          <Icon name="check" size={14} aria-hidden />
          <span>投稿可能{data.user.active_x_user_id ? ` · @${data.user.active_x_user_id}` : ""}</span>
          <AppLink href="/dashboard/settings?next=%2Fentry" className="fn-link fn-entry-status-actions">名義を切替</AppLink>
        </div>
      )}

      <div className="fn-entry-grid entry-choiceGrid">
        <section className="fn-entry-card entry-choiceCard">
          <h2 className="entry-cardTitle"><Icon name="calendar" size={16} aria-hidden /> イベントに参加する</h2>
          <p className="entry-cardLead">受付中のイベントの枠を確保して、作品を投稿できます。</p>
          {data && data.reservedSlots.length > 0 ? (
            <div className="entry-slotPanel entry-slotPanelProminent">
              <div className="entry-slotPanelHeader">
                <h3 className="entry-slotPanelTitle">確保済み枠に提出する</h3>
                <span className="entry-slotPanelCount">{data.reservedSlots.length}件</span>
              </div>
              <ul className="fn-pc-slot-list">
                {data.reservedSlots.map((slot) => {
                  const needsSubmission = !slot.video_id && slot.status === "reserved";
                  const href = resolvePostHref(`/entry/slotted?slot=${slot.id}`);
                  return (
                    <li key={slot.id}>
                      <div className="entry-slotRow">
                        <AppLink href={href} className="fn-pc-slot">
                          <span className="fn-pc-slot-info">
                            <span className="fn-pc-slot-label">{slot.event_title ?? slot.event_id}</span>
                            <span className="fn-mono fn-pc-slot-event">
                              {slot.start_time
                                ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}`
                                : (slot.slot_label ?? "件数枠")}
                            </span>
                            {slot.event_entry_end_time != null ? (
                              <span className="entry-slotDeadline">提出期限: {formatUnix(slot.event_entry_end_time)}</span>
                            ) : null}
                          </span>
                        </AppLink>
                        {needsSubmission ? (
                          <AppLink href={href} className="fn-btn fn-btn-primary fn-btn-sm">作品情報の登録を続ける</AppLink>
                        ) : <span className="entry-slotSubmitted">提出済み</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="entry-eventList">
            {!data ? (
              <p className="fn-text-muted-sm">ログイン後に受付中のイベントを確認できます。</p>
            ) : data.events.length === 0 ? (
              <p className="fn-text-muted-sm">現在受付中のイベントはありません。</p>
            ) : (
              data.events.map((event) => (
                <AppLink key={event.id} href={resolveSlotHref(`/event/${event.id}/slots`)} className="entry-eventCard">
                  <span className="entry-eventCardTitle">{event.title}</span>
                  <span className="entry-eventCardMeta">残り {event.slots_available} 枠</span>
                  {event.entry_end_time != null ? (
                    <span className="entry-eventCardMeta">募集終了: {formatUnix(event.entry_end_time)}</span>
                  ) : null}
                </AppLink>
              ))
            )}
            {data?.truncated ? (
              <p className="fn-text-muted-sm" role="status">受付中イベントの一部のみ表示しています。</p>
            ) : null}
          </div>
        </section>
        <section className="fn-entry-card entry-choiceCard">
          <h2 className="entry-cardTitle"><Icon name="edit" size={16} aria-hidden /> 過去の自分の作品を投稿する</h2>
          <p className="entry-cardLead">イベント枠に関係なく既存作品を登録できます。</p>
          <div className="entry-btnRow">
            <AppLink href={resolvePostHref("/entry/unslotted")} className="fn-btn fn-btn-primary">
              <Icon name="edit" size={14} aria-hidden />
              {writeCtaLabel(loggedIn ? "枠なし投稿" : "ログインして枠なし投稿")}
            </AppLink>
          </div>
        </section>
      </div>
    </div>
  );
}
