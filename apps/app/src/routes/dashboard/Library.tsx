import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { LibraryResponse, LibraryTab } from "@flamenode/contracts";
import type { PersonalApi } from "../../api/personal.js";
import { ResultView, useApiResult } from "../guard.js";
import { AppLink, useDocumentTitle } from "../ui/AppLink.js";
import { ChapterItems } from "../ui/ChapterItems.js";
import { Icon } from "../ui/Icon.js";
import { VideoCard } from "../ui/VideoCard.js";

/** CURRENT parseTab (library/page.tsx). The API applies the same rule; this only drives the degraded view. */
function parseTab(rawTab: string | null): LibraryTab {
  if (rawTab === "bookmark" || rawTab === "mine" || rawTab === "collab" || rawTab === "chapters") return rawTab;
  return "like";
}

/** CURRENT app/(auth)/dashboard/library/page.tsx. tab/page live in the URL, so deep link / reload / back-forward restore them. */
export function Library({ api }: { api: PersonalApi }): React.ReactElement {
  useDocumentTitle("ライブラリ");
  const [params] = useSearchParams();
  const rawTab = params.get("tab");
  const rawPage = params.get("page");
  const state = useApiResult(api, `library?tab=${rawTab ?? ""}&page=${rawPage ?? ""}`, (a, signal) =>
    a.getLibrary({ tab: rawTab, page: rawPage }, signal),
  );
  return (
    <ResultView
      state={state}
      next="/dashboard/library"
      unavailable={<LibraryShell tab={parseTab(rawTab)} unavailable />}
    >
      {(data) => <LibraryView data={data} />}
    </ResultView>
  );
}

const TABS = [
  ["like", "いいね"],
  ["bookmark", "セーブ"],
  ["mine", "自分の作品"],
  ["collab", "共同編集"],
  ["chapters", "チャプター"],
] as const;

function titleOf(tab: LibraryTab): string {
  return tab === "mine"
    ? "自分の作品"
    : tab === "collab"
      ? "共同編集できる作品"
      : tab === "chapters"
        ? "自分のチャプターコメント"
        : "ライブラリ";
}
function leadOf(tab: LibraryTab): string {
  return tab === "mine"
    ? "Active X ID 名義で投稿した作品を表示します。"
    : tab === "collab"
      ? "承認済み X ID で共同編集できる作品を表示します。"
      : tab === "chapters"
        ? "承認済み X ID で投稿したチャプターコメントを表示します。"
        : "自分がいいね・セーブした作品を一覧表示します。";
}

/** Header + tab row (always rendered) around either the unavailable notice or the list. */
function LibraryShell({
  tab,
  unavailable,
  children,
}: {
  tab: LibraryTab;
  unavailable?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head fn-library-head">
        <span className="fn-eyebrow">library</span>
        <h1 className="fn-display fn-page-title">{titleOf(tab)}</h1>
        <p className="fn-jp fn-page-lead">{leadOf(tab)}</p>
      </header>

      <nav role="tablist" className="fn-tab-row" aria-label="ライブラリ種別">
        {TABS.map(([value, label]) => (
          <AppLink
            key={value}
            role="tab"
            aria-selected={tab === value}
            href={`/dashboard/library?tab=${value}`}
            className={`fn-btn fn-btn-sm ${tab === value ? "fn-btn-primary" : "fn-btn-ghost"}`}
          >
            {value === "like" ? (
              <Icon name={tab === value ? "heart-filled" : "heart"} size={12} aria-hidden />
            ) : value === "bookmark" ? (
              <Icon name={tab === value ? "bookmark-filled" : "bookmark"} size={12} aria-hidden />
            ) : value === "mine" ? (
              <Icon name="grid" size={12} aria-hidden />
            ) : value === "collab" ? (
              <Icon name="users" size={12} aria-hidden />
            ) : (
              <Icon name="chapter" size={12} aria-hidden />
            )}
            {label}
          </AppLink>
        ))}
      </nav>

      {unavailable ? (
        <div className="fn-empty" role="status">
          <Icon name="info" size={20} aria-hidden />
          <p className="fn-empty-message">データを読み込めませんでした。ページを再読み込みしてください。</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function LibraryView({ data }: { data: LibraryResponse }): React.ReactElement {
  const { tab, page, hasNextPage, hasOtherTabHits, activeApprovedXId, approvedXIdCount, videos, chapters } = data;
  const playlistId = tab === "like" ? "lib-like" : "lib-bookmark";
  const playlistLabel = tab === "like" ? "いいねした作品" : "セーブした作品";
  const firstVideo = videos[0];
  const firstVideoHref =
    (tab === "like" || tab === "bookmark") && firstVideo
      ? `/${firstVideo.youtube_video_id?.trim() || firstVideo.id}?playlist=${playlistId}`
      : null;
  const emptyMessage =
    tab === "mine" && !activeApprovedXId
      ? "Active X ID を設定すると、その名義の作品を表示できます。"
      : tab === "mine"
        ? "自分の作品はまだ登録されていません。"
        : tab === "collab" && approvedXIdCount === 0
          ? "承認済み X ID がないため、共同編集できる作品を表示していません。"
          : tab === "collab"
            ? "共同編集できる作品はまだありません。"
            : tab === "chapters"
              ? "まだ投稿したチャプターコメントはありません。"
              : tab === "like"
                ? "まだ「いいね」した作品がありません。"
                : "まだ「セーブ」した作品がありません。";
  const itemCount = tab === "chapters" ? chapters.length : videos.length;
  const pageHref = (targetPage: number) => `/dashboard/library?tab=${tab}&page=${targetPage}`;

  return (
    <LibraryShell tab={tab}>
      {itemCount === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={20} aria-hidden />
          <p className="fn-empty-message">{emptyMessage}</p>
          {(tab === "like" || tab === "bookmark") && hasOtherTabHits ? (
            <p className="fn-muted fn-text-sm" style={{ textAlign: "center", marginTop: 6 }}>
              もう一方のタブには作品があります。
            </p>
          ) : null}
          {page > 1 ? (
            <AppLink href={pageHref(page - 1)} className="fn-btn fn-btn-ghost fn-btn-sm">
              前へ
            </AppLink>
          ) : null}
        </div>
      ) : (
        <>
          <div className="fn-toolbar">
            <span className="fn-muted fn-text-sm">
              {itemCount} 件を表示（ページ {page}）
            </span>
            {firstVideoHref ? (
              <AppLink href={firstVideoHref} className="fn-btn fn-btn-primary fn-btn-sm fn-toolbar-spacer">
                <Icon name="play" size={12} aria-hidden /> {playlistLabel}をプレイリストで見る
              </AppLink>
            ) : null}
          </div>
          {tab === "chapters" ? (
            <ChapterItems chapters={chapters} />
          ) : (
            <div className="fn-media-grid">
              {videos.map((video) => (
                <div key={video.id}>
                  <VideoCard
                    video={video}
                    href={
                      tab === "mine" || tab === "collab"
                        ? `/dashboard/edit/${video.id}`
                        : `/${video.youtube_video_id?.trim() || video.id}?playlist=${playlistId}`
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {page > 1 || hasNextPage ? (
            <nav className="fn-toolbar" aria-label="ページ移動">
              {page > 1 ? (
                <AppLink href={pageHref(page - 1)} className="fn-btn fn-btn-ghost fn-btn-sm">
                  前へ
                </AppLink>
              ) : (
                <span />
              )}
              {hasNextPage ? (
                <AppLink href={pageHref(page + 1)} className="fn-btn fn-btn-ghost fn-btn-sm">
                  次へ
                </AppLink>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </LibraryShell>
  );
}
