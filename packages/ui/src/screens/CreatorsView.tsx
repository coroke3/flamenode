import React from "react";
import { Image, Link } from "../adapters/index.js";
import { Pagination } from "../data/Pagination.js";
import { AutoSubmitSelect } from "../forms/AutoSubmitSelect.js";
import { ImeSafeGetForm } from "../forms/ImeSafeGetForm.js";
import { cx } from "../cx.js";
import { ScreenIcon } from "./parts.js";

/*
 * Creator index (`/user`) from the registered mock `docs/migration/mock/static/Creators.html`
 * (`cr-icons` grid, `field-i` search, `sel-i` sort). Texts, entry points and the `q` / `sort` / `page`
 * query contract follow CURRENT `app/(public)/user/UserIndexView.tsx`. The mock's view switcher
 * (icon / list / works) has no CURRENT counterpart and is not rendered (no do-nothing buttons).
 */

export type CreatorsSort = "score" | "works" | "name";

export interface CreatorsIndexEntry {
  /** X user ID; the profile URL key. */
  id: string;
  name: string;
  iconUrl?: string | null;
  ownCount: number;
  collabCount: number;
  totalCount: number;
}

export interface CreatorsViewProps {
  /** The creators of the current page. */
  creators: readonly CreatorsIndexEntry[];
  /** Count of all creators matching the query. */
  total: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  query: string;
  sort: CreatorsSort;
  /** CURRENT `unavailable`: the index could not be read. */
  unavailable?: boolean;
  buildHref: (page: number) => string;
  className?: string;
}

export function CreatorsView({
  creators,
  total,
  currentPage,
  totalPages,
  pageSize,
  query,
  sort,
  unavailable,
  buildHref,
  className,
}: CreatorsViewProps): React.ReactElement {
  const isEmpty = creators.length === 0;
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap cri-wrap">
        <div className="wrap-row cri-head">
          <h1 className="t-display">クリエイターを見つける</h1>
          {isEmpty ? null : <span className="t-sm muted t-num">{total} 件</span>}
        </div>

        <ImeSafeGetForm role="search" method="get" className="wrap-row cri-form">
          <div className="field-i cri-search">
            <div className="fn-field">
              <div className="fn-field__wrap">
                <input
                  className="fn-field__control"
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="名前 / X ID"
                  aria-label="クリエイター検索"
                  autoComplete="off"
                />
              </div>
            </div>
            <ScreenIcon name="search" />
          </div>
          <span className="cri-spacer" />
          <span className="sel-i" title="並び替え">
            <ScreenIcon name="sort" />
            <AutoSubmitSelect className="select i" name="sort" defaultValue={sort} aria-label="並び替え">
              <option value="score">おすすめ順</option>
              <option value="works">作品数順</option>
              <option value="name">名前順</option>
            </AutoSubmitSelect>
          </span>
          {query || sort !== "score" ? (
            <Link href="/user" className="fn-btn fn-btn--tertiary">
              リセット
            </Link>
          ) : null}
        </ImeSafeGetForm>

        {isEmpty ? (
          <p className="muted cri-empty">
            {unavailable
              ? "公開クリエイター一覧を一時的に表示できません。"
              : "条件に合うクリエイターが見つかりませんでした。"}
          </p>
        ) : (
          <>
            <div className="cr-icons">
              {creators.map((creator, index) => (
                <Link key={`${creator.id}-${index}`} href={`/user/${creator.id}`} className="stack cri-card">
                  {creator.iconUrl ? (
                    <Image className="round cri-av" src={creator.iconUrl} alt="" width={160} height={160} />
                  ) : (
                    <span className="round cri-av cri-av--empty" aria-hidden="true">
                      <ScreenIcon name="user" />
                    </span>
                  )}
                  <span className="stack cri-id">
                    <span className="cr-name">{creator.name}</span>
                    <span className="meta-i cr-meta cri-meta">
                      <span>@{creator.id}</span>
                      <span className="t-num">{creator.totalCount} 作品</span>
                    </span>
                    <small className="t-sm muted">
                      主催 {creator.ownCount} / 参加 {creator.collabCount}
                    </small>
                  </span>
                </Link>
              ))}
            </div>
            <Pagination
              className="cri-pager"
              currentPage={currentPage}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              buildHref={buildHref}
            />
          </>
        )}
      </main>
    </div>
  );
}
