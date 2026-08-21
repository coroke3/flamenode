import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";
import { ImeSafeGetForm } from "@/components/forms/ImeSafeGetForm";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import { buildPageMetadata } from "@/lib/seo";
import {
  isDegradedD1Mode,
  loadStaticUsersIndex,
  setPublicRequestRoute,
  type StaticUsersIndexEntry,
} from "@/lib/publicData/loader";
import {
  paginateUsersIndexItems,
  prepareUsersIndexItems,
  type UsersIndexSort,
} from "@/lib/publicData/staticUsersIndexCore";

export const metadata: Metadata = buildPageMetadata({
  path: "/user",
  title: "クリエイターを見つける",
  description:
    "FlameNodeで作品を公開している映像クリエイターと参加作品を探せます。",
});

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  sort?: string;
  page?: string;
}

const PAGE_SIZE = 48;

type CreatorRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  own_count: number;
  collab_count: number;
  total_count: number;
};

function parseUsersIndexSort(value: string | undefined): UsersIndexSort {
  return value === "name" || value === "works" ? value : "score";
}

function mapIndexEntry(entry: StaticUsersIndexEntry): CreatorRow {
  return {
    id: entry.x_id,
    x_name: entry.x_name,
    icon_url: entry.icon_url,
    own_count: entry.personal_count,
    collab_count: entry.collab_count,
    total_count: entry.total_works,
  };
}

export default async function UserListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const { q = "", sort = "score", page = "1" } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const sortKey = parseUsersIndexSort(sort);
  setPublicRequestRoute("/user");
  const staticLoaded = await loadStaticUsersIndex({
    page: pageNum,
    pageSize: PAGE_SIZE,
    q: q.trim() || undefined,
  });
  const isDegraded = isDegradedD1Mode(staticLoaded.mode);

  let creators: CreatorRow[];
  if (staticLoaded.index && !isDegraded) {
    creators = prepareUsersIndexItems(staticLoaded.index.items, q, sortKey).map(
      mapIndexEntry,
    );
  } else if (staticLoaded.index && isDegraded) {
    creators = staticLoaded.index.items.map(mapIndexEntry);
    if (q.trim()) {
      const keyword = q.trim().toLocaleLowerCase();
      creators = creators.filter(
        (creator) =>
          creator.x_name.toLocaleLowerCase().includes(keyword) ||
          creator.id.toLocaleLowerCase().includes(keyword),
      );
    }
    if (sortKey === "name") {
      creators.sort((a, b) => a.x_name.localeCompare(b.x_name, "ja"));
    }
  } else {
    creators = [];
  }

  const { total, totalPages, safePage, current } = paginateUsersIndexItems(
    creators,
    isDegraded ? 1 : pageNum,
    PAGE_SIZE,
  );

  const params = (override: Partial<SearchParams> = {}) => {
    const p = new URLSearchParams();
    const merged = { q, sort, page: String(safePage), ...override };
    if (merged.q) p.set("q", merged.q);
    if (merged.sort && merged.sort !== "score") p.set("sort", merged.sort);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    return p.toString();
  };

  return (
    <div className={`fn-public-container fn-page ${styles.page}`}>
      <header className="fn-page-head">
        <div className="fn-page-head-main">
          <span className="fn-eyebrow">CREATORS</span>
          <h1 className="fn-display fn-page-title">クリエイターを見つける</h1>
        </div>
      </header>

      <ImeSafeGetForm className={styles.controls} method="get">
        <label className={styles.searchBox}>
          <Icon name="search" size={14} aria-hidden />
          <span className="fn-sr-only">クリエイター検索</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="名前 / X ID"
            autoComplete="off"
          />
        </label>
        <label className={styles.sortBox}>
          <span>並び替え</span>
          <AutoSubmitSelect className="fn-select" name="sort" defaultValue={sort}>
            <option value="score">おすすめ順</option>
            <option value="works">作品数順</option>
            <option value="name">名前順</option>
          </AutoSubmitSelect>
        </label>
        {q || sort !== "score" ? (
          <Link href="/user" className="fn-btn fn-btn-ghost">
            リセット
          </Link>
        ) : null}
      </ImeSafeGetForm>

      {isDegraded ? (
        <p className="fn-muted fn-text-sm" role="status">
          簡易表示のため、作品数の集計や高度な並べ替えは利用できません。
        </p>
      ) : null}

      {current.length === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={24} aria-hidden />
          <p className="fn-empty-message">
            {staticLoaded.mode === "unavailable"
              ? "公開クリエイター一覧を一時的に表示できません。"
              : "条件に合うクリエイターが見つかりませんでした。"}
          </p>
        </div>
      ) : (
        <>
          <div className={styles.meta}>
            {isDegraded ? `${current.length} 件（簡易表示）` : `${total} 件`}
          </div>
          <div className={styles.grid}>
            {current.map((creator, index) => (
              <Link
                key={`${creator.id}-creator-${index}`}
                href={`/user/${creator.id}`}
                className={styles.card}
                prefetch={false}
              >
                <span className={styles.profile}>
                  {cachedGoogleImageUrl(creator.icon_url) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={cachedGoogleImageUrl(creator.icon_url) ?? ""}
                      alt=""
                      className={styles.avatar}
                      loading="lazy"
                    />
                  ) : (
                    <span className={styles.avatarFallback}>
                      <Icon name="user" size={20} aria-hidden />
                    </span>
                  )}
                  <span className={styles.identity}>
                    <span className={styles.name}>{creator.x_name}</span>
                    <span className={styles.handle}>@{creator.id}</span>
                  </span>
                </span>
                {!isDegraded ? (
                  <span className={styles.counts}>
                    {creator.total_count} 作品
                    <small>
                      主催 {creator.own_count} / 参加 {creator.collab_count}
                    </small>
                  </span>
                ) : null}
              </Link>
            ))}
          </div>

          {!isDegraded ? (
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              buildHref={(nextPage) => `/user?${params({ page: String(nextPage) })}`}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
