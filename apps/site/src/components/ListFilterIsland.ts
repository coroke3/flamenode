import React from "react";
import { createRoot } from "react-dom/client";
import { ListView } from "@flamenode/ui";
import { LIST_MAX_SEARCH_LENGTH, type ListQuery } from "../lib/listQuery.ts";
import {
  LIST_EVENT_UNAVAILABLE_MESSAGE, LIST_NO_RESULTS_MESSAGE, LIST_SHORT_SEARCH_MESSAGE,
  LIST_UNAVAILABLE_MESSAGE, decodePublicList, isDefaultListQuery, listHref,
  listQueryFromSearch, publicListApiPath,
} from "../lib/listFilterCore.ts";
import { fetchPublicJson } from "../lib/publicApi.ts";

const h = React.createElement;
type Loaded = NonNullable<ReturnType<typeof decodePublicList>>;
type ViewState = { kind: "idle" | "loading" | "error" } | { kind: "loaded"; data: Loaded };

function Filters({ query }: { query: ListQuery }): React.ReactElement {
  const filterCount = [query.q, query.sort !== "new" ? query.sort : "", query.event].filter(Boolean).length;
  const chip = (href: string, label: string) =>
    h("a", { className: "lv-filter-chip", href, key: label }, label, h("span", { "aria-hidden": "true" }, " ×"));
  return h(React.Fragment, null,
    h("details", { className: "lv-filter-panel", open: true },
      h("summary", null, "絞り込み", " ", h("span", { className: "muted t-sm" }, filterCount ? `${filterCount}件適用中` : "条件なし")),
      h("form", { action: "/list", method: "get", className: "fn-list-toolbar lv-filter-form", role: "search",
        onKeyDown: (event: React.KeyboardEvent<HTMLFormElement>) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); } },
        h("label", { className: "fn-list-search" },
          h("span", { className: "fn-sr-only" }, "検索キーワード"),
          h("input", { type: "search", name: "q", defaultValue: query.q, placeholder: "作品を検索（2文字以上）",
            autoComplete: "off", maxLength: LIST_MAX_SEARCH_LENGTH })),
        h("input", { type: "hidden", name: "view", value: query.view }),
        query.event ? h("input", { type: "hidden", name: "event", value: query.event }) : null,
        h("label", { className: "lv-sort-label" }, "並び替え",
          h("select", { className: "fn-select", name: "sort", defaultValue: query.sort,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => event.currentTarget.form?.requestSubmit() },
            h("option", { value: "new" }, "新着順"),
            h("option", { value: "old" }, "古い順"),
            h("option", { value: "score" }, "おすすめ順"))),
        h("button", { type: "submit", className: "fn-btn fn-btn--primary" }, "検索"),
        filterCount ? h("a", { href: "/list", className: "fn-btn fn-btn--tertiary" }, "リセット") : null)),
    h("nav", { className: "lv-view-options", "aria-label": "表示形式" },
      ...([["grid", "タイル表示"], ["compact", "コンパクト表示"], ["index", "一覧表示"]] as const).map(([view,label]) =>
        h("a", { key: view, href: listHref(query, { view, page: "1" }),
          "aria-current": query.view === view ? "page" : undefined }, label))),
    filterCount ? h("nav", { "aria-label": "適用中のフィルター", className: "lv-active-filters" },
      h("span", { className: "muted t-sm" }, "適用中"),
      query.q ? chip(listHref(query, { q: "", page: "1" }), `検索: ${query.q}`) : null,
      query.sort !== "new" ? chip(listHref(query, { sort: "new", page: "1" }),
        `並び順: ${query.sort === "old" ? "古い順" : "おすすめ順"}`) : null,
      query.event ? chip(listHref(query, { event: "", page: "1" }), `イベント: ${query.event}`) : null) : null);
}

function Pages({ query, data }: { query: ListQuery; data: Loaded }): React.ReactElement | null {
  if (data.totalPages <= 1) return null;
  const pages = Array.from({ length: Math.min(5, data.totalPages) }, (_, index) =>
    Math.max(1, Math.min(data.totalPages - 4, query.page - 2)) + index);
  const link = (page: number, label: string) => h("a", {
    key: label, href: listHref(query, { page: String(page) }), "aria-current": page === query.page ? "page" : undefined,
  }, label);
  return h("nav", { className: "lv-pagination", "aria-label": "ページ切り替え" },
    query.page > 1 ? link(query.page - 1, "前へ") : null,
    ...pages.map(page => link(page, String(page))),
    query.page < data.totalPages ? link(query.page + 1, "次へ") : null);
}

export function ListFilterIsland({ search }: { search: string }): React.ReactElement {
  const query = React.useMemo(() => listQueryFromSearch(search), [search]);
  const [state, setState] = React.useState<ViewState>({ kind: "idle" });

  React.useEffect(() => {
    if (isDefaultListQuery(query)) { setState({ kind: "idle" }); return; }
    if (query.searchTooShort) {
      setState({ kind: "loaded", data: { videos: [], total: 0, page: 1, totalPages: 1 } });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetchPublicJson<unknown>(publicListApiPath(query), { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      const data = result.ok ? decodePublicList(result.data, query) : null;
      setState(data ? { kind: "loaded", data } : { kind: "error" });
    });
    return () => controller.abort();
  }, [query]);

  React.useEffect(() => {
    const fallback = document.getElementById("list-static-fallback");
    if (!fallback) return;
    fallback.hidden = state.kind === "loaded";
    return () => { fallback.hidden = false; };
  }, [state.kind]);

  return h(React.Fragment, null,
    h(Filters, { query }),
    state.kind === "error" ? h("p", { role: "alert", className: "lv-island-status" },
      query.event ? LIST_EVENT_UNAVAILABLE_MESSAGE : LIST_UNAVAILABLE_MESSAGE) : null,
    state.kind === "loading" ? h("p", { role: "status", className: "lv-island-status" }, "作品を読み込んでいます…") : null,
    state.kind === "loaded" ? h(React.Fragment, null,
      h(ListView, { videos: state.data.videos, total: state.data.total, view: query.view,
        emptyMessage: query.searchTooShort ? LIST_SHORT_SEARCH_MESSAGE : LIST_NO_RESULTS_MESSAGE }),
      !query.searchTooShort ? h(Pages, { query, data: state.data }) : null) : null);
}

/** SSG remains useful without JS; only browser execution exposes the live filter controls. */
export function mountListFilters(root: Document = document): void {
  const host = root.getElementById("list-filter-mount");
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = "1";
  createRoot(host).render(h(ListFilterIsland, { search: window.location.search }));
}
