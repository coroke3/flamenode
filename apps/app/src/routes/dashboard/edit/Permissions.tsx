import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { EditPermissionsResponse } from "@flamenode/contracts";
import { getEditPermissions, type EditPermissionsReadResult } from "../../../api/videoCollaborators.js";
import { AuthUnavailable, BannedNotice, LoginRequired, SessionLoading } from "../../guard.js";
import { AppLink, useDocumentTitle } from "../../ui/AppLink.js";

type LoadState = { status: "loading" } | EditPermissionsReadResult;

/** MIG-0715 U01: intentionally unregistered until U02/U03 write + UI parity are complete. */
export function Permissions({ load = getEditPermissions }: { load?: typeof getEditPermissions }): React.ReactElement {
  useDocumentTitle("編集権限の管理");
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const modes = params.getAll("privileged");
  const queryKey = modes.join("\u0000");
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  React.useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    load({ videoId: id, privilegeModes: modes, signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setState(result);
      },
      () => {
        if (!controller.signal.aborted) setState({ status: "unavailable" });
      },
    );
    return () => controller.abort();
    // The key includes duplicate privileged values so URL history always refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, queryKey, load]);

  if (!id) return <NotFound />;
  if (state.status === "loading") return <SessionLoading />;
  if (state.status === "anonymous") return <LoginRequired next={"/dashboard/edit/" + encodeURIComponent(id) + "/permissions"} />;
  if (state.status === "banned") return <BannedNotice />;
  if (state.status === "unavailable") return <AuthUnavailable />;
  if (state.status === "not_found") return <NotFound />;
  return <PermissionsReadView videoId={id} data={state.data} />;
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
}: {
  videoId: string;
  data: EditPermissionsResponse;
}): React.ReactElement {
  const href = editHref(videoId, data.privilegeMode);
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
            {/* U03 will replace this read-only inventory with the CURRENT permission manager. */}
            <h2>共同編集者</h2>
            <ul>
              {data.subjects.map((subject) => (
                <li key={subject.x_user_id}>
                  {subject.display_name}（@{subject.x_user_id}） — {subject.can_edit === 1 ? "編集可" : "編集不可"}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <p className="fn-page-footnote">
        監査ログは管理者向け画面で確認できます。通常の作品編集は
        <AppLink href={href}>編集ページ</AppLink>から行ってください。
      </p>
    </div>
  );
}
