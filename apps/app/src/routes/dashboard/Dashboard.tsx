import * as React from "react";
import type { DashboardResponse } from "@flamenode/contracts";
import type { PersonalApi } from "../../api/personal.js";
import { ResultView, useApiResult } from "../guard.js";
import { onboardingHref } from "../next.js";
import { buildAccentVars } from "../ui/accent.js";
import { AppLink, useDocumentTitle } from "../ui/AppLink.js";
import { ChapterItems } from "../ui/ChapterItems.js";
import { formatUnix } from "../ui/format.js";
import { Icon } from "../ui/Icon.js";
import { VideoCard } from "../ui/VideoCard.js";

/**
 * CURRENT app/(auth)/dashboard/page.tsx (guard next="/dashboard"). Read-only: data from GET /api/personal/dashboard.
 * Class names that were CSS-module members in CURRENT are plain `dash-*` classes until the stylesheet port lands.
 */
export function Dashboard({ api }: { api: PersonalApi }): React.ReactElement {
  useDocumentTitle("ダッシュボード");
  const state = useApiResult(api, "dashboard", (a, signal) => a.getDashboard(signal));
  return (
    <ResultView state={state} next="/dashboard" unavailable={<DashboardUnavailable />}>
      {(data) => <DashboardView data={data} />}
    </ResultView>
  );
}

/** CURRENT `!db` branch: data could not be loaded (the API answered 5xx / network failure). */
function DashboardUnavailable(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-dash dash-page">
      <div className="fn-empty" role="status">
        <p className="fn-empty-message">データを読み込めませんでした。ページを再読み込みしてください。</p>
      </div>
    </div>
  );
}

export function DashboardView({ data }: { data: DashboardResponse }): React.ReactElement {
  const { user, onboarding, linkedXUsers: xIds, myVideos, collabVideos, myChapters, activeSlot, stats } = data;
  const approvedXIds = Array.from(
    new Set(xIds.filter((x) => x.approval_status === "approved").map((x) => x.id)),
  );

  const activeXRow = user.active_x_user_id ? (xIds.find((x) => x.id === user.active_x_user_id) ?? null) : null;
  const dashboardName = activeXRow?.x_name ?? user.name ?? "FlameNode User";
  const dashboardHandle = activeXRow
    ? `@${activeXRow.id}`
    : user.active_x_user_id
      ? `@${user.active_x_user_id}`
      : xIds.length === 0
        ? "X ID 未連携"
        : "X ID 未選択";
  const dashboardIcon = activeXRow?.icon_url ?? user.image ?? null;
  const dashboardInitial = (dashboardName.trim().charAt(0) || user.name?.trim().charAt(0) || "F").toUpperCase();
  const galleryEmptyMessage =
    xIds.length === 0
      ? "X ID を連携すると、承認後に作品の投稿やマイ・ギャラリーが使えるようになります。"
      : approvedXIds.length === 0
        ? "承認済み X ID がないため、作品を表示していません。"
        : !onboarding.activeApprovedXId
          ? "Active X ID を設定すると、その名義の作品が表示されます。"
          : "自分の作品はまだ登録されていません。";
  const collabEmptyMessage =
    xIds.length === 0
      ? "X ID を連携すると、共同編集できる作品が表示されます。"
      : approvedXIds.length === 0
        ? "承認済み X ID がないため、共同編集できる作品を表示していません。"
        : "共同編集できる作品はまだありません。";

  return (
    <div className="fn-public-container fn-page fn-dash dash-page">
      <header className="fn-dash-head dash-accountHeader">
        <div className="fn-dash-id dash-accountIdentity">
          {dashboardIcon ? (
            <img src={dashboardIcon} alt="" className="fn-dash-avatar dash-accountAvatar" />
          ) : (
            <span className="fn-dash-avatar-fallback dash-accountAvatarFallback">{dashboardInitial}</span>
          )}
          <div className="fn-dash-id-text">
            <span className="fn-eyebrow">my account</span>
            <h1 className="fn-display fn-dash-name">{dashboardName}</h1>
            <span className="fn-mono fn-dash-handle">{dashboardHandle}</span>
          </div>
        </div>
        <div className="fn-dash-actions dash-accountActions">
          <AppLink href="/dashboard/settings" className="fn-btn fn-btn-ghost fn-btn-sm">
            <Icon name="settings" size={13} aria-hidden /> 設定
          </AppLink>
          <AppLink href="/entry" className="fn-btn fn-btn-primary fn-btn-lg">
            <Icon name="plus" size={14} aria-hidden /> 新規投稿
          </AppLink>
        </div>
      </header>

      {onboarding.needsTermsAcceptance ? (
        <div className="fn-pc-status-banner" role="status" style={{ marginBottom: 20 }}>
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">初期設定が未完了です</h3>
            <p className="fn-jp fn-pc-banner-lead">
              作品投稿やイベント参加には、利用規約への同意と活動名義の登録が必要です。
            </p>
            <AppLink href={onboardingHref("/dashboard")} className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12">
              初期設定を進める
            </AppLink>
          </div>
        </div>
      ) : onboarding.xIdentityStatus === "none" ? (
        <div className="fn-pc-status-banner" role="status" style={{ marginBottom: 20 }}>
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">X ID 未連携</h3>
            <p className="fn-jp fn-pc-banner-lead">
              投稿・一部機能には X ID が必要です。
              {onboarding.canReserveSlot ? " 枠確保は可能です。" : ""}
            </p>
            <AppLink href="/dashboard/settings?next=/dashboard" className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12">
              X ID を連携する
            </AppLink>
          </div>
        </div>
      ) : onboarding.xIdentityStatus === "rejected" ? (
        <div className="fn-pc-status-banner fn-pc-status-banner--warn" role="status" style={{ marginBottom: 20 }}>
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">X ID 申請を確認できませんでした</h3>
            <p className="fn-jp fn-pc-banner-lead">申請が却下されました。設定から再申請できます。</p>
            <AppLink href={onboardingHref("/dashboard")} className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12">
              再申請する
            </AppLink>
          </div>
        </div>
      ) : onboarding.xIdentityStatus === "pending" ? (
        <div className="fn-pc-status-banner" role="status" style={{ marginBottom: 20 }}>
          <Icon name="clock" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">申請完了・承認待ち</h3>
            <p className="fn-jp fn-pc-banner-lead">
              {onboarding.requestedXId
                ? `@${onboarding.requestedXId} の連携を運営が確認しています。`
                : "X ID 連携の申請を運営が確認しています。"}{" "}
              イベント枠の確保は利用できます。作品投稿は承認後に利用可能です。
            </p>
            <AppLink href={onboardingHref("/dashboard")} className="fn-btn fn-btn-ghost fn-btn-sm fn-mt-12">
              申請状況を見る
            </AppLink>
          </div>
        </div>
      ) : onboarding.xIdentityStatus === "approved" && !onboarding.activeApprovedXId ? (
        <div className="fn-pc-status-banner" role="status" style={{ marginBottom: 20 }}>
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">活動名義（Active X ID）の設定が必要です</h3>
            <p className="fn-jp fn-pc-banner-lead">
              承認済みの X ID があります。投稿に使う Active X ID を設定してください。
            </p>
            <AppLink href="/dashboard/settings?next=/dashboard" className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12">
              設定で Active X ID を選ぶ
            </AppLink>
          </div>
        </div>
      ) : null}

      <HeroCard activeSlot={activeSlot} canPost={onboarding.canPost} />

      <section className="fn-dash-kpis dash-statsGrid" aria-label="アカウント統計">
        <Stat label="累計いいね" value={stats.likes.toLocaleString()} />
        <Stat label="累計再生数" value={stats.views.toLocaleString()} />
        <Stat label="投稿作品" value={`${stats.video_count} 本`} />
        <Stat label="参加イベント" value={`${stats.event_count} 本`} />
      </section>
      {xIds.length > 1 ? (
        <p className="fn-muted fn-text-sm" style={{ marginBottom: 20 }}>
          統計は連携済み名義の合算です。マイ・ギャラリーは Active X ID の作品のみ表示します。
        </p>
      ) : null}

      <section className="fn-dash-section dash-section">
        <h2 className="fn-dash-section-title dash-sectionTitle">連携 X ID</h2>
        {xIds.length === 0 ? (
          <div className="fn-empty">
            <Icon name="user" size={20} aria-hidden />
            <p className="fn-empty-message">X ID がまだ連携されていません。</p>
            <AppLink
              href={onboarding.canReserveSlot ? "/dashboard/settings" : onboardingHref("/dashboard")}
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              {onboarding.canReserveSlot ? "X ID を連携する" : "初期設定を続ける"}
            </AppLink>
          </div>
        ) : (
          <div className="dash-xidList">
            {xIds.map((x) => (
              <div key={x.id} className="dash-xidCard">
                {x.icon_url ? (
                  <img src={x.icon_url} alt="" className="dash-xidIcon" />
                ) : (
                  <span className="dash-xidIconFb">
                    <Icon name="user" size={16} aria-hidden />
                  </span>
                )}
                <div className="dash-xidBody">
                  <div className="dash-xidName">{x.x_name}</div>
                  <div className="dash-xidId">@{x.id}</div>
                </div>
                {x.approval_status === "pending" ? (
                  <span className="fn-badge fn-badge-warning">承認待ち</span>
                ) : x.approval_status === "rejected" ? (
                  <span className="fn-badge fn-badge-danger">再申請</span>
                ) : x.id === user.active_x_user_id ? (
                  <span className="fn-badge fn-badge-accent">アクティブ</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="fn-dash-section dash-section">
        <div className="dash-sectionHeader">
          <h2 className="fn-dash-section-title dash-sectionTitle">自分の作品</h2>
          {myVideos.hasMore ? (
            <AppLink href="/dashboard/library?tab=mine" className="fn-btn fn-btn-ghost fn-btn-sm">
              すべて見る
            </AppLink>
          ) : null}
        </div>
        {myVideos.items.length === 0 ? (
          <div className="fn-empty">
            <Icon name="grid" size={20} aria-hidden />
            <p className="fn-empty-message">{galleryEmptyMessage}</p>
            <AppLink href={xIds.length === 0 ? "/dashboard/settings" : "/entry"} className="fn-btn fn-btn-primary fn-mt-md">
              {xIds.length === 0 ? "X ID を連携する" : "作品を投稿する"}
            </AppLink>
          </div>
        ) : (
          <div className="fn-gallery-grid dash-galleryGrid">
            {myVideos.items.map((video) => (
              <VideoCard key={video.id} video={video} href={`/dashboard/edit/${video.id}`} />
            ))}
          </div>
        )}
      </section>

      <section className="fn-dash-section dash-section">
        <div className="dash-sectionHeader">
          <h2 className="fn-dash-section-title dash-sectionTitle">共同編集できる作品</h2>
          {collabVideos.hasMore ? (
            <AppLink href="/dashboard/library?tab=collab" className="fn-btn fn-btn-ghost fn-btn-sm">
              すべて見る
            </AppLink>
          ) : null}
        </div>
        {collabVideos.items.length === 0 ? (
          <div className="fn-empty">
            <Icon name="users" size={20} aria-hidden />
            <p className="fn-empty-message">{collabEmptyMessage}</p>
          </div>
        ) : (
          <div className="fn-gallery-grid dash-galleryGrid">
            {collabVideos.items.map((video) => (
              <VideoCard key={video.id} video={video} href={`/dashboard/edit/${video.id}`} />
            ))}
          </div>
        )}
      </section>

      <section className="fn-dash-section dash-section">
        <div className="dash-sectionHeader">
          <h2 className="fn-dash-section-title dash-sectionTitle">自分のチャプターコメント</h2>
          {myChapters.hasMore ? (
            <AppLink href="/dashboard/library?tab=chapters" className="fn-btn fn-btn-ghost fn-btn-sm">
              すべて見る
            </AppLink>
          ) : null}
        </div>
        {myChapters.items.length === 0 ? (
          <div className="fn-empty">
            <Icon name="chapter" size={20} aria-hidden />
            <p className="fn-empty-message">まだ投稿したチャプターコメントはありません。</p>
          </div>
        ) : (
          <ChapterItems chapters={myChapters.items} />
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="fn-dash-kpi dash-statCard">
      <span className="fn-dash-kpi-v">{value}</span>
      <span className="fn-dash-kpi-k fn-jp">{label}</span>
    </div>
  );
}

function HeroCard({
  activeSlot,
  canPost,
}: {
  activeSlot: DashboardResponse["activeSlot"];
  canPost: boolean;
}): React.ReactElement {
  if (!activeSlot) {
    return (
      <section className="fn-card fn-mb-lg">
        <div className="fn-card-body">
          <p className="fn-muted fn-text-sm">現在、ステータス更新が必要な枠はありません。</p>
          <p className="fn-mt-sm fn-text-sm">開催中のイベントがある場合は、エントリー画面から枠を確保できます。</p>
          <AppLink href="/entry" className="fn-btn fn-btn-primary fn-mt-md">
            <Icon name="calendar" size={14} aria-hidden /> エントリーへ
          </AppLink>
        </div>
      </section>
    );
  }

  const { slot, event } = activeSlot;
  return (
    <section style={event.accent_color?.trim() ? buildAccentVars(event.accent_color, "dark") : undefined}>
      <div className={`fn-card fn-highlight-card ${slot.status === "submitted" ? "fn-card-accent" : ""}`}>
        <div className="fn-card-body">
          <div className="fn-highlight-card-kicker">
            <Icon name="alert" size={12} aria-hidden /> アクティブ枠
          </div>
          <h2 className="fn-highlight-card-title">{event.title}</h2>
          <p className="fn-highlight-card-lead">
            {slot.start_time
              ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(slot.start_time, { timeOnly: true })}`
              : (slot.slot_label ?? "未指定")}
            {" · "}
            <span>状態: {slot.status}</span>
          </p>
          <div className="fn-highlight-card-actions">
            {slot.status === "submitted" && slot.video_id ? (
              <>
                <AppLink href={`/dashboard/edit/${slot.video_id}`} className="fn-btn fn-btn-primary">
                  <Icon name="edit" size={14} aria-hidden /> 提出内容を確認
                </AppLink>
                <AppLink href={`/event/${event.id}`} className="fn-btn fn-btn-ghost">
                  イベントへ
                </AppLink>
              </>
            ) : slot.status === "reserved" ? (
              <AppLink
                href={canPost ? `/entry/slotted?slot=${slot.id}` : onboardingHref(`/entry/slotted?slot=${slot.id}`)}
                className="fn-btn fn-btn-primary"
              >
                <Icon name="upload" size={14} aria-hidden /> 動画を提出する
              </AppLink>
            ) : (
              <AppLink href="/entry" className="fn-btn fn-btn-primary">
                <Icon name="calendar" size={14} aria-hidden /> 枠を確保する
              </AppLink>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
