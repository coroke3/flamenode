import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { EditPermissionsResponse } from "@flamenode/contracts";
import { getEditPermissions, type EditPermissionsReadResult } from "../../../api/videoCollaborators.js";
import { VideoCollabPermsManager } from "../../../components/VideoCollabPermsManager.js";
import type { NotificationUrlEnv, NotificationRuntimeMode } from "../../../lib/videoPermissionNotification.js";
import { AuthUnavailable, BannedNotice, LoginRequired, SessionLoading } from "../../guard.js";
import { AppLink, useDocumentTitle } from "../../ui/AppLink.js";
import { Icon } from "../../ui/Icon.js";
import { ACTIVE_X_CHANGED_EVENT } from "../../../lib/activeXSwitchEvents.js";
import { videoPageHref } from "../../../lib/youtubeId.js";

type LoadState = { status: "loading" } | EditPermissionsReadResult;
type ManagerHostInput = {
  authorityKey: string;
  notificationUrlEnv: NotificationUrlEnv & { NODE_ENV: NotificationRuntimeMode };
};
type ManagerHost = ManagerHostInput & { onRefresh: () => void };

const reloadDocument = () => window.location.reload();

/** MIG-0715: route remains unregistered until MIG-0650 is DONE; no live host adapter is supplied yet. */
export function Permissions({
  load = getEditPermissions,
  reload = reloadDocument,
  hostAdapterForTest,
}: {
  load?: typeof getEditPermissions;
  reload?: () => void;
  /** Explicit test-only host fixture; never supplied by the live router. */
  hostAdapterForTest?: ManagerHostInput;
}): React.ReactElement {
  useDocumentTitle("編集権限の管理");
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const modes = params.getAll("privileged");
  if (!id) return <NotFound />;
  // Resource and exact ordered query tuple own the whole read lifecycle. A
  // new resource/mode must render loading before any passive-effect cleanup.
  // JSON encoding distinguishes duplicate values and embedded separators.
  return <PermissionsForResource key={JSON.stringify([id, modes])} id={id} modes={modes} load={load} reload={reload} hostAdapterForTest={hostAdapterForTest} />;
}

function PermissionsForResource({ id, modes, load, reload, hostAdapterForTest }: {
  id: string;
  modes: readonly string[];
  load: typeof getEditPermissions;
  reload: () => void;
  hostAdapterForTest?: ManagerHostInput;
}): React.ReactElement {
  const queryKey = JSON.stringify(modes);
  const [snapshot, setSnapshot] = React.useState<{ loader: typeof load; result: LoadState }>({
    loader: load,
    result: { status: "loading" },
  });
  const state: LoadState = snapshot.loader === load ? snapshot.result : { status: "loading" };
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshFailed, setRefreshFailed] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setRefreshFailed(false);
    setRefreshKey((value) => value + 1);
  }, []);

  // Auth transitions use hard navigation; the committed Active X signal and
  // BFCache restore must also retire this private view as a full document.
  React.useEffect(() => {
    const onActiveXChanged = () => reload();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reload();
    };
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, onActiveXChanged);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener(ACTIVE_X_CHANGED_EVENT, onActiveXChanged);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [reload]);

  React.useEffect(() => {
    const controller = new AbortController();
    // A post-write refresh keeps the last committed read view on screen instead
    // of flashing SessionLoading. The manager is hidden while the receipt is
    // refreshed; only a fresh authorized, non-truncated receipt re-enables it.
    const preservePrevious = refreshKey > 0 && state.status === "ok";
    if (!preservePrevious) setSnapshot({ loader: load, result: { status: "loading" } });
    Promise.resolve()
      .then(() => load({ videoId: id, privilegeModes: modes, signal: controller.signal }))
      .then(
        (result) => {
          if (controller.signal.aborted) return;
          // Even an injected loader cannot display a receipt for another video.
          const ownedResult = result.status === "ok" && result.data.kind === "ok" && result.data.video.id !== id
            ? { status: "unavailable" as const }
            : result;
          if (preservePrevious && ownedResult.status === "unavailable") {
            // Keep the previous inventory read-only; never leave stale write controls enabled.
            setRefreshing(false);
            setRefreshFailed(true);
            return;
          }
          setSnapshot({ loader: load, result: ownedResult });
          setRefreshing(false);
          setRefreshFailed(false);
        },
        () => {
          if (controller.signal.aborted) return;
          if (preservePrevious) {
            setRefreshing(false);
            setRefreshFailed(true);
          } else {
            setSnapshot({ loader: load, result: { status: "unavailable" } });
            setRefreshing(false);
            setRefreshFailed(false);
          }
        },
      );
    return () => controller.abort();
    // Capture the committed view at the refresh boundary; refreshKey is the trigger.
    // Exact ordered values (including duplicates) are represented by queryKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, queryKey, load, refreshKey]);


  if (state.status === "loading") return <SessionLoading />;
  if (state.status === "anonymous") return <LoginRequired next={"/dashboard/edit/" + encodeURIComponent(id) + "/permissions"} />;
  if (state.status === "banned") return <BannedNotice />;
  if (state.status === "unavailable") return <AuthUnavailable />;
  if (state.status === "not_found") return <NotFound />;
  // The live route does not pass this adapter until MIG-0650 is DONE.
  const managerHost: ManagerHost | undefined = hostAdapterForTest
    ? { ...hostAdapterForTest, onRefresh }
    : undefined;
  return (
    <PermissionsReadView
      videoId={id}
      data={state.data}
      managerHost={managerHost}
      refreshing={refreshing}
      refreshFailed={refreshFailed}
    />
  );
}

function NotFound(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-guard-shell">
      <div className="fn-empty fn-guard-card">
        <h1 className="fn-guard-title">ページが見つかりません</h1>
      </div>
    </div>
  );
}

function editHref(videoId: string, mode: "normal" | "admin" | "event"): string {
  return "/dashboard/edit/" + encodeURIComponent(videoId) + (mode === "normal" ? "" : "?privileged=" + mode);
}

export function PermissionsReadView({
  videoId,
  data,
  managerHost,
  refreshing = false,
  refreshFailed = false,
}: {
  videoId: string;
  data: EditPermissionsResponse;
  managerHost?: ManagerHost;
  refreshing?: boolean;
  refreshFailed?: boolean;
}): React.ReactElement {
  const href = editHref(videoId, data.privilegeMode);
  const id = encodeURIComponent(videoId);
  if (data.kind === "no_access") {
    return (
      <div className="fn-public-container fn-page fn-guard-shell">
        <div className="fn-empty fn-guard-card">
          <h1 className="fn-guard-title">編集権限がありません</h1>
          <p className="fn-empty-message">
            共同編集権限を管理する権限がありません。作品の作者、または
            video.permissions を持つ運営・管理者のみ設定できます。
          </p>
          <AppLink href={href} className="fn-btn fn-btn-ghost fn-btn-sm fn-mt-md">
            作品編集へ戻る
          </AppLink>
        </div>
      </div>
    );
  }

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <p className="fn-eyebrow"><AppLink href={href}>← 作品編集へ戻る</AppLink></p>
        <h1 className="fn-page-title fn-page-title--compact">編集できる人を管理</h1>
        <p className="fn-page-lead">
          作品「{data.video.title}」を編集できる人を設定します。
          公開メンバーとして表示するかどうかとは別です。
        </p>
      </header>
      {/* CURRENT AdminVideoTabs: an authorized admin-mode receipt can only be issued by Hono.
          Query parameters alone never select these links. */}
      {data.privilegeMode === "admin" ? (
        <nav className="fn-console-resource-tabs" aria-label="作品管理メニュー">
          {([
            { key: "detail", href: `/admin/videos/${id}`, label: "管理詳細", icon: "info" },
            { key: "members", href: `/admin/videos/${id}/members`, label: "メンバー", icon: "users" },
            { key: "edit", href: `/dashboard/edit/${id}?privileged=admin`, label: "内容編集", icon: "edit" },
            { key: "permissions", href: `/dashboard/edit/${id}/permissions?privileged=admin`, label: "編集権限", icon: "settings" },
            { key: "public", href: videoPageHref(data.video), label: "公開ページ", icon: "external" },
            { key: "audit", href: `/admin/audit?table=videos&record=${id}`, label: "監査ログ", icon: "clock" },
          ] as const).map((tab) => (
            <AppLink
              key={tab.key}
              href={tab.href}
              className={`fn-btn fn-btn-sm ${tab.key === "permissions" ? "fn-btn-primary" : "fn-btn-ghost"}`}
              aria-current={tab.key === "permissions" ? "page" : undefined}
            >
              <Icon name={tab.icon} size={11} aria-hidden />
              {tab.label}
            </AppLink>
          ))}
        </nav>
      ) : null}

      {!data.showCollabSection ? (
        <section className="fn-card">
          <div className="fn-card-body">
            <p className="fn-text-muted-sm">この作品は個人投稿のため、合作向けの編集権限管理は不要です。</p>
          </div>
        </section>
      ) : (
        <section className="fn-card">
          <div className="fn-card-body">
            {data.truncated ? (
              <p role="alert">共同編集者の情報が一部省略されています。省略された一覧から権限を更新しないでください。</p>
            ) : null}
            {managerHost && !data.truncated && !refreshing && !refreshFailed ? (
              <VideoCollabPermsManager
                videoId={data.video.id}
                videoTitle={data.video.title}
                subjects={data.subjects}
                publicMembers={data.publicMembers}
                editPrivilegeMode={data.privilegeMode}
                authorityKey={managerHost.authorityKey}
                notificationUrlEnv={managerHost.notificationUrlEnv}
                onRefresh={managerHost.onRefresh}
              />
            ) : (
              <>
                {refreshing ? (
                  <p role="status">保存しました。最新の一覧を確認しています。</p>
                ) : null}
                {refreshFailed ? (
                  <p role="alert">
                    最新の編集権限を取得できませんでした。安全のため変更操作を停止しました。ページを再読み込みして確認してください。
                  </p>
                ) : null}
                <h2>共同編集者</h2>
                <ul>
                  {data.subjects.map((subject) => (
                    <li key={subject.x_user_id}>
                      {subject.display_name}（@{subject.x_user_id}） — {subject.can_edit === 1 ? "編集可" : "編集不可"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
      <p className="fn-page-footnote">
        <Icon name="info" size={12} aria-hidden />
        監査ログは管理者向け画面で確認できます。通常の作品編集は
        <AppLink href={href}>編集ページ</AppLink>から行ってください。
      </p>
    </div>
  );
}
