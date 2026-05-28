"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatDuration } from "@/lib/utils/format";

export interface MemberRow {
  id: string;
  x_user_id: string | null;
  name: string | null;
  role: string | null;
  comment: string | null;
  order_index: number | null;
  x_name: string | null;
  icon_url: string | null;
  chapters?: { chapter_time: number }[];
}

type SortKey = "default" | "name" | "id" | "chapters" | "role" | "comment";
type SortDir = "asc" | "desc";

const HEADERS: { key: SortKey; label: string; minWidth?: number }[] = [
  { key: "name", label: "活動名" },
  { key: "id", label: "ID" },
  { key: "chapters", label: "チャプター" },
  { key: "role", label: "役割" },
  { key: "comment", label: "コメント" },
];

function compareString(a: string | null, b: string | null, dir: SortDir): number {
  const av = a ?? "";
  const bv = b ?? "";
  const cmp = av.localeCompare(bv, "ja");
  return dir === "asc" ? cmp : -cmp;
}

function sortMembers(rows: MemberRow[], key: SortKey, dir: SortDir): MemberRow[] {
  if (key === "default") {
    return [...rows]; // 元順 = 取得時の order_index 順を保つ
  }
  const out = [...rows];
  out.sort((a, b) => {
    if (key === "name") {
      return compareString(a.x_name ?? a.name, b.x_name ?? b.name, dir);
    }
    if (key === "id") {
      return compareString(a.x_user_id, b.x_user_id, dir);
    }
    if (key === "role") {
      return compareString(a.role, b.role, dir);
    }
    if (key === "chapters") {
      const av = a.chapters?.[0]?.chapter_time ?? Number.POSITIVE_INFINITY;
      const bv = b.chapters?.[0]?.chapter_time ?? Number.POSITIVE_INFINITY;
      return dir === "asc" ? av - bv : bv - av;
    }
    if (key === "comment") {
      return compareString(a.comment, b.comment, dir);
    }
    return 0;
  });
  return out;
}

export function MemberTable({
  members,
}: {
  members: MemberRow[];
}): React.ReactElement {
  const [sortKey, setSortKey] = React.useState<SortKey>("default");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");

  const sorted = React.useMemo(
    () => sortMembers(members, sortKey, sortDir),
    [members, sortKey, sortDir],
  );

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <table className="fn-table">
      <thead>
        <tr>
          {HEADERS.map((h) => {
            const active = sortKey === h.key;
            const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
            return (
              <th
                key={h.key}
                aria-sort={
                  active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                <button
                  type="button"
                  onClick={() => onSort(h.key)}
                  style={{
                    background: "transparent",
                    border: 0,
                    color: "inherit",
                    font: "inherit",
                    cursor: "pointer",
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {h.label}
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{arrow || " ⇅"}</span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((m) => {
          // icon_url は fetchVideoDetail 側で resolveMemberIcons により
          // x_users.icon_url → そのメンバーの過去作品アイコン → null の順で解決済み。
          const displayName = m.x_name ?? m.name;
          return (
            <tr key={m.id}>
              <td>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {m.icon_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={m.icon_url}
                      alt=""
                      width={28}
                      height={28}
                      style={{
                        borderRadius: 999,
                        objectFit: "cover",
                        background: "var(--bg-elevated)",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        background: "var(--bg-elevated)",
                        color: "var(--text-muted)",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Icon name="user" size={14} aria-hidden />
                    </span>
                  )}
                  <span>{displayName}</span>
                </span>
              </td>
              <td>
                {m.x_user_id ? (
                  <Link href={`/user/${m.x_user_id}`}>@{m.x_user_id}</Link>
                ) : (
                  <span className="fn-muted">-</span>
                )}
              </td>
              <td>
                {m.chapters && m.chapters.length > 0 ? (
                  m.chapters
                    .map((chapter) => formatDuration(chapter.chapter_time))
                    .join(" / ")
                ) : (
                  <span className="fn-muted">-</span>
                )}
              </td>
              <td>
                {m.role ? <strong>{m.role}</strong> : <span className="fn-muted">-</span>}
              </td>
              <td>
                {m.comment ?? <span className="fn-muted">-</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
