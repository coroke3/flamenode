"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * 公開ページ向けの合作メンバーリスト。
 *
 * 旧 MemberTable は `fn-table` ベースで管理画面っぽさが強かったため、
 * 公開ページでは丸アイコン + 名前 + 役割の縦リストに置き換える。
 *
 * - 名前 / @id は内部ユーザーページへリンク (1 つの <Link> ラッパー)
 * - x_user_id があれば、その外側に X 外部リンクアイコンを並べる
 * - 役割とコメントは名前の下に控えめに表示
 * - メンバー数が多い場合でも崩れないよう、レスポンシブグリッドで並べる
 */

export interface MemberListItem {
  id: string;
  x_user_id: string | null;
  name: string | null;
  role: string | null;
  comment: string | null;
  x_name: string | null;
  icon_url: string | null;
}

export function MemberList({
  members,
}: {
  members: readonly MemberListItem[];
}): React.ReactElement | null {
  if (members.length === 0) return null;
  return (
    <ul
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
        gap: 10,
        margin: 0,
        padding: 0,
        listStyle: "none",
      }}
    >
      {members.map((m) => (
        <li key={m.id}>
          <MemberRow member={m} />
        </li>
      ))}
    </ul>
  );
}

function MemberRow({ member }: { member: MemberListItem }): React.ReactElement {
  const displayName = member.x_name ?? member.name ?? "anonymous";
  const internalHref = member.x_user_id ? `/user/${member.x_user_id}` : null;
  const xExternal = member.x_user_id
    ? `https://x.com/${member.x_user_id}`
    : null;

  const avatar = (
    <span
      style={{
        flex: "0 0 auto",
        width: 36,
        height: 36,
        borderRadius: 999,
        background: "var(--bg-elevated)",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        color: "var(--text-muted)",
      }}
      aria-hidden
    >
      {member.icon_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={member.icon_url}
          alt=""
          width={36}
          height={36}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <Icon name="user" size={16} aria-hidden />
      )}
    </span>
  );

  const nameBlock = (
    <span style={{ display: "grid", gap: 1, minWidth: 0, flex: 1 }}>
      <span
        style={{
          fontWeight: 700,
          fontSize: 13,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {displayName}
      </span>
      {member.x_user_id ? (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          @{member.x_user_id}
        </span>
      ) : null}
    </span>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 10px",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* 名前 / アイコン本体は内部リンク。外部リンクは <Link> の外に出して a ネストを避ける。 */}
        {internalHref ? (
          <Link
            href={internalHref}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
              flex: 1,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            {avatar}
            {nameBlock}
          </Link>
        ) : (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
              flex: 1,
            }}
          >
            {avatar}
            {nameBlock}
          </span>
        )}
        {xExternal ? (
          <a
            href={xExternal}
            target="_blank"
            rel="noopener noreferrer"
            className="fn-icon-btn"
            aria-label={`X (@${member.x_user_id}) を開く`}
            title={`X (@${member.x_user_id})`}
            style={{ flex: "0 0 auto" }}
          >
            <Icon name="x" size={12} aria-hidden />
          </a>
        ) : null}
      </div>
      {member.role || member.comment ? (
        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            color: "var(--text-muted)",
            lineHeight: 1.55,
            paddingLeft: 46,
          }}
        >
          {member.role ? <strong>{member.role}</strong> : null}
          {member.role && member.comment ? " / " : ""}
          {member.comment ?? ""}
        </p>
      ) : null}
    </div>
  );
}
