import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { withDatabase } from "@/lib/cloudflare";
import {
  fetchPublicEventGroupBySlug,
  fetchPublicEventsForGroup,
  type PublicEventGroupDetail,
  type PublicGroupEvent,
} from "@/lib/db/eventGroups";
import { readStaticJson } from "@/lib/publicData/staticJson";

export const dynamic = "force-dynamic";

const GROUP_TYPE_LABELS: Record<string, string> = {
  series: "系列",
  genre: "ジャンル",
  related: "関連",
  collection: "コレクション",
  other: "その他",
};

function formatDate(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

type StaticGroupPayload = {
  group: PublicEventGroupDetail;
  events: PublicGroupEvent[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const staticPayload = await readStaticJson<StaticGroupPayload>(
    `groups/${slug}.json`,
  );
  const group =
    staticPayload?.group ??
    (await withDatabase(async (db) => {
      return fetchPublicEventGroupBySlug(db, slug);
    }));
  if (!group) return { title: "グループが見つかりません" };
  return {
    title: group.name,
    description: group.description ?? undefined,
    openGraph: {
      title: group.name,
      description: group.description ?? undefined,
      images: group.img_url ? [group.img_url] : undefined,
    },
  };
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const staticPayload = await readStaticJson<StaticGroupPayload>(
    `groups/${slug}.json`,
  );
  const group =
    staticPayload?.group ??
    (await withDatabase(async (db) => {
      return fetchPublicEventGroupBySlug(db, slug);
    }));

  if (!group) notFound();

  const groupEvents =
    staticPayload?.events ??
    ((await withDatabase(async (db) => {
      return fetchPublicEventsForGroup(db, group.id);
    })) ?? []);

  return (
    <div className="fn-public-container fn-page">
      <header
        className="fn-page-head"
        style={group.accent_color ? { borderBottom: `3px solid ${group.accent_color}` } : undefined}
      >
        <p className="fn-eyebrow">
          <Link href="/groups" style={{ color: "inherit", textDecoration: "none" }}>
            グループ
          </Link>
          {" › "}
          {GROUP_TYPE_LABELS[group.group_type] ?? group.group_type}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {group.icon_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={group.icon_url}
              alt=""
              style={{ width: 40, height: 40, borderRadius: "50%" }}
            />
          ) : null}
          <h1 className="fn-page-title">{group.name}</h1>
        </div>
        {group.description ? (
          <p className="fn-page-lead">{group.description}</p>
        ) : null}
      </header>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
          所属イベント ({groupEvents.length}件)
        </h2>
        {groupEvents.length === 0 ? (
          <p className="fn-muted" style={{ padding: "24px 0", textAlign: "center" }}>
            このグループの公開イベントはまだありません。
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {groupEvents.map((ev) => (
              <Link
                key={ev.id}
                href={`/event/${ev.id}`}
                className="fn-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 16,
                  textDecoration: "none",
                  color: "inherit",
                  borderTop: ev.accent_color ? `3px solid ${ev.accent_color}` : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {ev.icon_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={ev.icon_url} alt="" style={{ width: 20, height: 20, borderRadius: "50%" }} />
                  ) : null}
                  <span className="fn-badge" style={{ fontSize: 10, padding: "2px 6px" }}>
                    {ev.event_type ?? "event"}
                  </span>
                  {ev.relation_type !== "member" ? (
                    <span className="fn-badge" style={{ fontSize: 10, padding: "2px 6px", background: "var(--accent-primary-soft)" }}>
                      {ev.relation_type}
                    </span>
                  ) : null}
                </div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{ev.title}</h3>
                {ev.explanation ? (
                  <p className="fn-muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {ev.explanation}
                  </p>
                ) : null}
                <div style={{ marginTop: "auto", fontSize: 12, color: "var(--text-muted)" }}>
                  {formatDate(ev.start_time)}
                  {ev.end_time ? ` 〜 ${formatDate(ev.end_time)}` : ""}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
