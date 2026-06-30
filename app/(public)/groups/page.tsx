import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { withDatabase } from "@/lib/cloudflare";
import {
  fetchPublicEventGroups,
  type PublicEventGroupCard,
} from "@/lib/db/eventGroups";
import { readStaticJson } from "@/lib/publicData/staticJson";
import { EventDirectoryNav } from "@/components/event/EventDirectoryNav";

export const metadata: Metadata = {
  title: "イベントグループ",
  description: "系列・ジャンル・関連イベントからイベントを探せます。",
};
export const dynamic = "force-dynamic";

const GROUP_TYPE_LABELS: Record<string, string> = {
  series: "系列",
  genre: "ジャンル",
  related: "関連",
  collection: "コレクション",
  other: "その他",
};

export default async function GroupsPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string }>;
}): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const typeFilter = sp.type && GROUP_TYPE_LABELS[sp.type] ? sp.type : "all";

  const dbGroups =
    (await withDatabase(async (db) => {
      return fetchPublicEventGroups(db, { type: typeFilter });
    })) ?? [];

  const staticPayload =
    dbGroups.length === 0
      ? await readStaticJson<{
          items: PublicEventGroupCard[];
        }>("groups/index.json")
      : null;
  const staticGroups = staticPayload?.items ?? null;

  const groups =
    dbGroups.length > 0
      ? dbGroups
      : (staticGroups?.filter((group) =>
          typeFilter === "all" ? true : group.group_type === typeFilter,
        ) ?? []);

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <div className="fn-page-head-main">
          <p className="fn-eyebrow">event groups</p>
          <h1 className="fn-page-title">イベントグループ</h1>
          <EventDirectoryNav active="groups" />
        </div>
      </header>

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <Link
          href="/groups"
          className={`fn-btn fn-btn-sm ${typeFilter === "all" ? "fn-btn-primary" : "fn-btn-ghost"}`}
          aria-current={typeFilter === "all" ? "page" : undefined}
        >
          すべて
        </Link>
        {Object.entries(GROUP_TYPE_LABELS).map(([key, label]) => (
          <Link
            key={key}
            href={`/groups?type=${key}`}
            className={`fn-btn fn-btn-sm ${typeFilter === key ? "fn-btn-primary" : "fn-btn-ghost"}`}
            aria-current={typeFilter === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>

      {groups.length === 0 ? (
        <p className="fn-muted" style={{ padding: "40px 0", textAlign: "center" }}>
          公開中のイベントグループはありません。
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.slug}`}
              className="fn-card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 16,
                textDecoration: "none",
                color: "inherit",
                borderTop: g.accent_color ? `3px solid ${g.accent_color}` : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {g.icon_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={g.icon_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} />
                ) : null}
                <span
                  className="fn-badge"
                  style={{ fontSize: 10, padding: "2px 6px" }}
                >
                  {GROUP_TYPE_LABELS[g.group_type] ?? g.group_type}
                </span>
              </div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{g.name}</h2>
              {g.description ? (
                <p className="fn-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {g.description}
                </p>
              ) : null}
              <div style={{ marginTop: "auto", fontSize: 12, color: "var(--text-muted)" }}>
                {g.event_count}件のイベント
                {g.latest_event_title ? (
                  <> · {g.latest_event_title}</>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
