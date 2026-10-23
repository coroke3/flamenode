import React from "react";
import { CreatorView, EmptyState } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";
import {
  USER_COLLAB_DISPLAY_PAGE_SIZE,
  USER_WORKS_DISPLAY_PAGE_SIZE,
  profilePageHref,
  type CreatorHeader,
  type SectionPages,
} from "../lib/userViews.ts";

/**
 * `/user/[id]` as one Island (MIG-0504). The HTML is static page 1 of both sections. CURRENT serves
 * `?worksPage=` / `?collabPage=` from a dynamic route; the static file is the same for every query, so
 * this Island reads the query after hydration and switches to that display page. Every page of both
 * sections is in the props (at most 15 + 15 pages of 8 cards, the CURRENT limit).
 * A page CURRENT answers with 404 (beyond the last page, or its artifact was not published) shows a notice.
 */
export interface CreatorProfileIslandProps {
  header: CreatorHeader;
  works: SectionPages;
  collabs: SectionPages;
}

/** CURRENT `clampPaging`: a finite number >= 1, floored; anything else is page 1. */
function pageFromQuery(value: string | null): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function section(
  userId: string,
  key: "worksPage" | "collabPage",
  data: SectionPages,
  page: number,
  pageSize: number,
) {
  // undefined: beyond the last page; null: that page's artifact was not published. CURRENT answers 404 for both.
  const items = data.pages[page - 1];
  return {
    items: items ?? [],
    total: data.total,
    currentPage: page,
    totalPages: data.pages.length,
    pageSize,
    buildHref: (next: number) => profilePageHref(userId, key, next),
    found: items != null,
  };
}

export function CreatorProfileIsland({ header, works, collabs }: CreatorProfileIslandProps): React.ReactElement {
  const [pages, setPages] = React.useState({ works: 1, collabs: 1 });
  React.useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const next = { works: pageFromQuery(query.get("worksPage")), collabs: pageFromQuery(query.get("collabPage")) };
    if (next.works !== 1 || next.collabs !== 1) setPages(next);
  }, []);

  const worksSection = section(header.id, "worksPage", works, pages.works, USER_WORKS_DISPLAY_PAGE_SIZE);
  const collabSection = section(header.id, "collabPage", collabs, pages.collabs, USER_COLLAB_DISPLAY_PAGE_SIZE);
  const body =
    worksSection.found && collabSection.found
      ? React.createElement(CreatorView, { creator: { ...header, works: worksSection, collabs: collabSection } })
      : React.createElement(
          "div",
          { className: "p-root fn-screen" },
          React.createElement(
            "main",
            { className: "wrap scr-empty" },
            React.createElement(EmptyState, {
              title: "ページが見つかりません",
              description: "指定されたページは存在しません。",
              action: { href: profilePageHref(header.id, "worksPage", 1), label: "プロフィールへ戻る" },
            }),
          ),
        );
  return React.createElement(IslandWrapper, null, body);
}

export default CreatorProfileIsland;
