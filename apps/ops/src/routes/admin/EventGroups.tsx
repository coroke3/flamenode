/**
 * MIG-0728 U01: CURRENT /admin/event-groups list screen.
 */
import * as React from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { AdminEventGroupsResponse } from "@flamenode/contracts";
import {
  eventGroupPublicHref,
  eventGroupsQuery,
  readAdminEventGroups,
} from "../../api/adminEventGroups.js";
import { adminReadRedirect } from "../../api/adminTop.js";
import type { OpsFetch } from "../../api/read.js";
import { AdminSectionTabs } from "../../components/shared/AdminSectionTabs.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { Icon } from "../../components/shared/Icon.js";
import { useApiResult } from "../useApiResult.js";

const GROUP_TYPE_LABELS: Record<string, string> = {
  series: "系列",
  genre: "ジャンル",
  related: "関連",
  collection: "コレクション",
  other: "その他",
};

type FilterName = "visibility" | "type";

function EventGroupsView({
  data,
  notice,
  error,
  onFilterChange = () => {},
}: {
  data: AdminEventGroupsResponse;
  notice?: string;
  error?: string;
  onFilterChange?: (name: FilterName, value: string) => void;
}): React.ReactElement {
  return (
    <section className="fn-page" aria-label="イベントグループ管理">
      <ConsolePageHeader
        title="イベントグループ管理"
        description="系列・ジャンルなどのイベントグループと所属イベントを管理します。"
        actions={[
          {
            href: "/admin/event-groups/new",
            label: "新規グループ",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

      <AdminSectionTabs hub="events" />

      {notice ? (
        <p className="fn-alert fn-alert-success" role="status" style={{ marginBottom: 12 }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="fn-alert fn-alert-danger" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}

      <form
        method="get"
        role="search"
        onSubmit={(e) => e.preventDefault()}
        style={{
          marginTop: 14,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          name="visibility"
          aria-label="公開状態"
          className="fn-select"
          value={data.visibility}
          onChange={(e) => onFilterChange("visibility", e.currentTarget.value)}
        >
          <option value="any">公開状態すべて</option>
          <option value="public">公開</option>
          <option value="private">非公開</option>
          <option value="archived">アーカイブ</option>
        </select>
        <select
          name="type"
          aria-label="種別"
          className="fn-select"
          value={data.type}
          onChange={(e) => onFilterChange("type", e.currentTarget.value)}
        >
          <option value="any">種別すべて</option>
          {Object.entries(GROUP_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </form>

      <FnTable style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th scope="col">表示順</th>
            <th scope="col">名前</th>
            <th scope="col">種別</th>
            <th scope="col">公開状態</th>
            <th scope="col">イベント数</th>
            <th scope="col" aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => (
            <tr key={g.id}>
              <td className="fn-mono">{g.sort_order ?? 0}</td>
              <td>
                <strong>{g.name}</strong>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {eventGroupPublicHref(g.slug)}
                </div>
              </td>
              <td>{GROUP_TYPE_LABELS[g.group_type] ?? g.group_type}</td>
              <td>
                {g.visibility_status === "public" ? (
                  <span className="fn-badge fn-badge-accent">公開</span>
                ) : g.visibility_status === "private" ? (
                  <span className="fn-badge fn-badge-soft">非公開</span>
                ) : (
                  <span className="fn-badge fn-badge-soft">アーカイブ</span>
                )}
              </td>
              <td>{g.event_count}</td>
              <td>
                <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                  <Link
                    to={`/admin/event-groups/${encodeURIComponent(g.id)}/edit`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    編集
                  </Link>
                  {g.visibility_status === "public" ? (
                    <a
                      href={eventGroupPublicHref(g.slug)}
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      target="_blank"
                      rel="noreferrer"
                    >
                      公開ページ
                    </a>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {data.groups.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <p className="fn-empty-message" style={{ padding: 16, textAlign: "center" }}>
                  イベントグループはまだありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </FnTable>
    </section>
  );
}

export function EventGroupsPage({
  fetchFn,
}: { fetchFn?: OpsFetch } = {}): React.ReactElement {
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const urlParams = new URLSearchParams(search);
  const notice = (urlParams.get("notice") ?? "").slice(0, 200);
  const error = (urlParams.get("error") ?? "").slice(0, 200);
  const key = eventGroupsQuery(params);

  const result = useApiResult(
    (signal) => readAdminEventGroups(new URLSearchParams(key), fetchFn, signal),
    "admin-event-groups?" + key,
  );
  const redirect = result.status === "loading" ? null : adminReadRedirect(result);
  React.useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  function changeFilter(name: FilterName, value: string): void {
    const next = new URLSearchParams(key);
    next.set(name, value);
    setParams(eventGroupsQuery(next));
  }

  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden") {
    return <p role="status">読み込み中…</p>;
  }
  if (result.status !== "ok") {
    return <p role="alert">イベントグループを取得できませんでした。再読み込みしてください。</p>;
  }
  return (
    <EventGroupsView
      data={result.data}
      notice={notice}
      error={error}
      onFilterChange={changeFilter}
    />
  );
}
