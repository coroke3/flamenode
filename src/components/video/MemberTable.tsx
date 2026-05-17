"use client";

import * as React from "react";
import Link from "next/link";

export interface MemberRow {
  id: string;
  x_user_id: string | null;
  name: string | null;
  role: string | null;
  comment: string | null;
  order_index: number | null;
  x_name: string | null;
  icon_url: string | null;
}

type SortKey = "default" | "name" | "id" | "role";
type SortDir = "asc" | "desc";

const HEADERS: { key: SortKey; label: string; minWidth?: number }[] = [
  { key: "default", label: "No" },
  { key: "name", label: "Name" },
  { key: "id", label: "ID" },
  { key: "role", label: "担当 / コメント" },
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
        {sorted.map((m, i) => (
          <tr key={m.id}>
            <td>{sortKey === "default" ? i + 1 : "—"}</td>
            <td>{m.x_name ?? m.name}</td>
            <td>
              {m.x_user_id ? (
                <Link href={`/user/${m.x_user_id}`}>@{m.x_user_id}</Link>
              ) : (
                <span className="fn-muted">-</span>
              )}
            </td>
            <td>
              {m.role ? <strong>{m.role}</strong> : null}
              {m.role && m.comment ? " / " : ""}
              {m.comment ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
