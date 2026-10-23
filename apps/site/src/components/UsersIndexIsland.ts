import React from "react";
import { CreatorsView, type CreatorsSort } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";
import type { StaticUsersIndexEntry } from "../../../../src/lib/publicData/staticUsersIndexCore.ts";
import {
  USERS_INDEX_PAGE_SIZE,
  computeUsersIndexView,
  parseIndexPage,
  parseUsersIndexSort,
  usersIndexQuery,
  type UsersIndexView,
} from "../lib/userViews.ts";

/**
 * `/user` as one Island (MIG-0504). The HTML is the default view (page 1, おすすめ順). CURRENT rewrites
 * `/user?q=&sort=&page=` to a dynamic route; the static file is the same for every query, so this Island
 * reads the query after hydration, fetches the build-time index (`indexUrl`) and applies the same CURRENT
 * filter / sort / paging. An index that cannot be read shows CURRENT's "unavailable" notice.
 */
export interface UsersIndexIslandProps {
  initial: UsersIndexView;
  unavailable: boolean;
  indexUrl: string;
}

interface State {
  q: string;
  sort: CreatorsSort;
  view: UsersIndexView;
  unavailable: boolean;
}

export function UsersIndexIsland({ initial, unavailable, indexUrl }: UsersIndexIslandProps): React.ReactElement {
  const [state, setState] = React.useState<State>({ q: "", sort: "score", view: initial, unavailable });

  React.useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const q = query.get("q") ?? "";
    const sort = parseUsersIndexSort(query.get("sort"));
    const page = parseIndexPage(query.get("page"));
    if (!q && sort === "score" && page === 1) return;
    let cancelled = false;
    fetch(indexUrl)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<StaticUsersIndexEntry[]>;
      })
      .then((entries) => {
        if (!cancelled) setState({ q, sort, view: computeUsersIndexView(entries, q, sort, page), unavailable: false });
      })
      .catch(() => {
        if (cancelled) return;
        const empty: UsersIndexView = { creators: [], total: 0, totalPages: 1, safePage: 1 };
        setState({ q, sort, view: empty, unavailable: true });
      });
    return () => {
      cancelled = true;
    };
  }, [indexUrl]);

  const { q, sort, view } = state;
  return React.createElement(
    IslandWrapper,
    null,
    React.createElement(CreatorsView, {
      key: `${q}\n${sort}`,
      creators: view.creators,
      total: view.total,
      currentPage: view.safePage,
      totalPages: view.totalPages,
      pageSize: USERS_INDEX_PAGE_SIZE,
      query: q,
      sort,
      unavailable: state.unavailable,
      buildHref: (page: number) => `/user?${usersIndexQuery(q, sort, page)}`,
    }),
  );
}

export default UsersIndexIsland;
