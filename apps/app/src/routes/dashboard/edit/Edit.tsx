import * as React from "react";
import type { EditAccess, EditNotice, EditPageResponse } from "@flamenode/contracts";
import { createVideoEditApi, type VideoEditApi, type VideoEditResult } from "../../../api/videoEdit.js";
import { VideoEditPermissionSummary } from "../../../components/permission/VideoEditPermissionSummary.js";
import { videoPageHref, youtubeWatchUrl } from "../../../lib/youtubeId.js";
import { AuthUnavailable, BannedNotice, LoginRequired, SessionLoading } from "../../guard.js";
import { AppLink, useDocumentTitle } from "../../ui/AppLink.js";
import { Icon } from "../../ui/Icon.js";

type PrivilegeMode = EditAccess["privilegeMode"];
type EditPageWithHeader = Exclude<EditPageResponse, { kind: "no_access" }>;
type ReadState = VideoEditResult<EditPageResponse>;

interface EditProps {
  api?: VideoEditApi;
  videoId: string;
  search: string;
  /** Caller-owned key that changes with the authenticated session or active X identity. */
  identityKey: string;
}

const NOTICE: Record<EditNotice, string> = {
  switch_admin: "通常編集モードでは編集できる項目がありません。上部の「管理者権限で編集」から明示的に権限を切り替えてください。",
  switch_event: "通常編集モードでは編集できる項目がありません。上部の「イベント運営権限で編集」から明示的に権限を切り替えてください。",
  event_staff_insufficient: "この作品に対する運営権限が不足しています。",
  owner_policy_denied: "この項目は、現在の一般作品権限では編集できません。",
  not_editable: "この作品を編集できません。作品の作者、編集権限を付与された合作メンバー、または権限を持つ運営のみ編集できます。",
};

const UNAVAILABLE = { status: "unavailable" } as const;
const defaultApi = createVideoEditApi();

async function readEdit({ api, videoId, mode, signal }: {
  api: VideoEditApi;
  videoId: string;
  mode: PrivilegeMode;
  signal: AbortSignal;
}): Promise<ReadState> {
  const result = await api.getPage(videoId, mode, signal);
  if (signal.aborted) return UNAVAILABLE;
  if (result.status !== "ok") return result;
  const page = result.data;
  if (page.kind !== "no_access" && page.video.id !== videoId) return UNAVAILABLE;
  if (page.kind !== "edit") return result;
  if (page.membersTruncated || page.collabTruncated) return UNAVAILABLE;

  const optionsResult = await api.getFormOptions(videoId, mode, signal);
  if (optionsResult.status !== "ok") return optionsResult;
  const options = optionsResult.data;
  // Authorization may have changed between the reads. A cut snapshot also cannot establish form inputs.
  if (options.kind !== "ready") return UNAVAILABLE;
  if (options.customAnswersTruncated || options.truncated || options.nextOffset !== null) return UNAVAILABLE;
  return result;
}

/** Read boundary for the future trusted route host. Neither read grants write authority. */
export function Edit({ api = defaultApi, videoId, search, identityKey }: EditProps): React.ReactElement {
  useDocumentTitle("作品を編集");
  const privileged = new URLSearchParams(search).getAll("privileged");
  const requested = privileged.length === 1 ? privileged[0] : undefined;
  const mode = requested === "admin" || requested === "event" ? requested : "normal";
  return <EditReadBoundary key={JSON.stringify([identityKey, videoId, mode])} api={api} videoId={videoId} mode={mode} />;
}

// Keep the request lifecycle and its terminal views together so no partial read can render the private shell.
function EditReadBoundary({ api, videoId, mode }: {
  api: VideoEditApi;
  videoId: string;
  mode: PrivilegeMode;
}): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<{ api: VideoEditApi; state: ReadState } | null>(null);
  React.useEffect(() => {
    setSnapshot(null);
    const controller = new AbortController();
    const publish = (state: ReadState) => {
      if (!controller.signal.aborted) setSnapshot({ api, state });
    };
    readEdit({ api, videoId, mode, signal: controller.signal }).then(publish, () => publish(UNAVAILABLE));
    return () => controller.abort();
  }, [api, videoId, mode]);

  const state = snapshot?.api === api ? snapshot.state : null;
  if (!state) return <SessionLoading />;
  if (state.status === "anonymous") return <LoginRequired next={`/dashboard/edit/${encodeURIComponent(videoId)}`} />;
  if (state.status === "banned") return <BannedNotice />;
  if (state.status === "unavailable") return <AuthUnavailable />;
  if (state.status === "not_found") {
    return (
      <div className="fn-public-container fn-page">
        <section className="fn-empty-state">
          <Icon name="info" size={18} aria-hidden />
          <h1>ページが見つかりません</h1>
          <p>URL を確認するか、トップページから再度お探しください。</p>
          <AppLink href="/" className="fn-btn fn-btn-primary">トップへ戻る</AppLink>
        </section>
      </div>
    );
  }

  const page = state.data;
  if (page.kind === "no_access") {
    const publicHref = videoPageHref({ id: videoId, youtube_video_id: page.public_id });
    return (
      <div className="fn-public-container fn-page fn-guard-shell">
        <div className="fn-status-panel fn-status-panel--center fn-status-panel--warn">
          <h1 className="fn-guard-title fn-guard-title--warn">編集権限がありません</h1>
          <p className="fn-status-panel-lead">{NOTICE[page.message]}</p>
          <div className="fn-panel-actions fn-panel-actions--row">
            <AppLink href="/dashboard" className="fn-btn fn-btn-ghost">ダッシュボードへ</AppLink>
            <AppLink href={publicHref} className="fn-btn fn-btn-primary">公開ページを見る</AppLink>
          </div>
        </div>
      </div>
    );
  }

  const notice = page.kind === "switch_only" ? NOTICE[page.message] : editNotice(page);
  return (
    <div className="fn-public-container fn-page fn-page--video-edit">
      <EditHeader page={page} videoId={videoId} />
      {notice ? (
        <div className="fn-status-panel fn-status-panel--warn" role="status">
          <p className="fn-status-panel-lead">{notice}</p>
        </div>
      ) : null}
      {page.kind === "edit" && page.permissionSummary ? (
        <VideoEditPermissionSummary videoId={page.video.id} summary={page.permissionSummary} privilegeMode={page.access.privilegeMode} />
      ) : null}
      <div className="fn-page-footer-actions">
        <AppLink href="/dashboard" className="fn-btn fn-btn-ghost">ダッシュボードへ戻る</AppLink>
      </div>
    </div>
  );
}

function editNotice(page: Extract<EditPageResponse, { kind: "edit" }>): string | null {
  const { canEditAnySection, privilegeMode, canOfferEventMode, canOfferAdminMode } = page.access;
  if (canEditAnySection) return null;
  if (privilegeMode === "normal" && canOfferEventMode) {
    return "イベント運営権限で編集できる項目があります。上部の「イベント運営権限で編集」を選択してください。";
  }
  if (privilegeMode === "normal" && canOfferAdminMode) {
    return "管理者権限で編集できる項目があります。上部の「管理者権限で編集」を選択してください。";
  }
  return "現在の権限では編集できる項目がありません。";
}

function EditHeader({ page, videoId }: { page: EditPageWithHeader; videoId: string }): React.ReactElement {
  const { access, user, video } = page;
  const mode = access.privilegeMode;
  const showAdmin = user.role === "admin" && mode !== "admin";
  const showEvent = access.canOfferEventMode && mode !== "event";
  const showNormal = mode !== "normal";
  const base = `/dashboard/edit/${encodeURIComponent(videoId)}`;
  return (
    <header className="fn-page-head">
      <p className="fn-eyebrow">EDIT</p>
      <h1 className="fn-page-title fn-page-title--compact">{video.title}</h1>
      <p className="fn-page-meta">
        現在の状態:
        <span className="fn-badge fn-badge-soft">{video.visibility_status}</span>
        {video.youtube_video_id ? (
          <a href={youtubeWatchUrl(video.youtube_video_id)} target="_blank" rel="noopener noreferrer" className="fn-btn fn-btn-ghost fn-btn-sm">
            <Icon name="external" size={12} aria-hidden />
            YouTube で確認
          </a>
        ) : null}
        <AppLink href={videoPageHref(video)} className="fn-btn fn-btn-ghost fn-btn-sm">
          <Icon name="external" size={12} aria-hidden />
          FlameNode で見る
        </AppLink>
      </p>
      {showAdmin || showEvent || showNormal ? (
        <div className={`fn-privilege-banner fn-privilege-banner--${mode} fn-privilege-banner--switch`} aria-label="編集権限モードの切替">
          <span className="fn-privilege-banner-actions">
            {showAdmin ? <AppLink href={`${base}?privileged=admin`} className="fn-btn fn-btn-ghost fn-btn-sm">管理者権限で編集</AppLink> : null}
            {showEvent ? <AppLink href={`${base}?privileged=event`} className="fn-btn fn-btn-ghost fn-btn-sm">イベント運営権限で編集</AppLink> : null}
            {showNormal ? <AppLink href={base} className="fn-btn fn-btn-ghost fn-btn-sm">通常モードへ戻る</AppLink> : null}
          </span>
        </div>
      ) : null}
    </header>
  );
}
