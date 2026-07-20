"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./MemberSection.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";

export interface MemberSectionMember {
  id: string;
  x_user_id: string | null;
  name: string | null;
  role: string | null;
  comment: string | null;
  x_name: string | null;
  icon_url: string | null;
}

interface MemberSectionProps {
  members: readonly MemberSectionMember[];
}

type ViewMode = "cards" | "table";
type SortKey = "order" | "name" | "handle" | "role";
type SortDirection = "asc" | "desc";

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

function memberDisplayName(member: MemberSectionMember): string {
  return member.name ?? member.x_name ?? "anonymous";
}

function memberHandle(member: MemberSectionMember): string {
  return member.x_user_id ?? "";
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "", "ja", {
    numeric: true,
    sensitivity: "base",
  });
}

function sortMembers(
  members: readonly MemberSectionMember[],
  sort: SortState | null,
): MemberSectionMember[] {
  const withIndex = members.map((member, index) => ({ member, index }));
  if (!sort) return withIndex.map((entry) => entry.member);

  const direction = sort.direction === "asc" ? 1 : -1;
  withIndex.sort((left, right) => {
    let result = 0;
    if (sort.key === "order") result = left.index - right.index;
    else if (sort.key === "name") {
      result = compareText(
        memberDisplayName(left.member),
        memberDisplayName(right.member),
      );
    } else if (sort.key === "handle") {
      result = compareText(memberHandle(left.member), memberHandle(right.member));
    } else {
      result = compareText(left.member.role, right.member.role);
    }
    return result === 0 ? left.index - right.index : result * direction;
  });
  return withIndex.map((entry) => entry.member);
}

export function MemberSection({
  members,
}: MemberSectionProps): React.ReactElement | null {
  const [mode, setMode] = React.useState<ViewMode>("cards");
  if (members.length === 0) return null;

  return (
    <div className={styles.root}>
      <div className={styles.tabs} role="tablist" aria-label="メンバー表示切替">
        <TabButton
          icon="users"
          label="カード"
          active={mode === "cards"}
          onClick={() => setMode("cards")}
        />
        <TabButton
          icon="list"
          label="テーブル"
          active={mode === "table"}
          onClick={() => setMode("table")}
        />
      </div>
      {mode === "cards" ? <CardsView members={members} /> : null}
      {mode === "table" ? <TableView members={members} /> : null}
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: "users" | "list";
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(styles.tab, active && styles.tabActive)}
      onClick={onClick}
    >
      <Icon name={icon} size={13} aria-hidden />
      {label}
    </button>
  );
}

function CardsView({
  members,
}: {
  members: readonly MemberSectionMember[];
}): React.ReactElement {
  return (
    <ul className={styles.cardGrid}>
      {members.map((member) => (
        <li key={member.id}>
          <MemberCard member={member} />
        </li>
      ))}
    </ul>
  );
}

function MemberCard({
  member,
}: {
  member: MemberSectionMember;
}): React.ReactElement {
  const displayName = member.x_name ?? member.name ?? "anonymous";
  const internalHref = member.x_user_id ? `/user/${member.x_user_id}` : null;
  const xExternal = member.x_user_id
    ? `https://x.com/${encodeURIComponent(member.x_user_id)}`
    : null;
  const iconUrl = cachedGoogleImageUrl(member.icon_url);
  const avatar = (
    <span className={styles.avatar} aria-hidden>
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" width={36} height={36} />
      ) : (
        <Icon name="user" size={16} aria-hidden />
      )}
    </span>
  );
  const nameBlock = (
    <span className={styles.nameBlock}>
      <span className={styles.name}>{displayName}</span>
      {member.x_user_id ? (
        <span className={styles.handle}>@{member.x_user_id}</span>
      ) : null}
    </span>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        {internalHref ? (
          <Link href={internalHref} className={styles.cardLink}>
            {avatar}
            {nameBlock}
          </Link>
        ) : (
          <span className={styles.cardLink}>
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
          >
            <Icon name="x" size={12} aria-hidden />
          </a>
        ) : null}
      </div>
      {member.role || member.comment ? (
        <p className={styles.cardMeta}>
          {member.role ? <strong>{member.role}</strong> : null}
          {member.role && member.comment ? " / " : ""}
          {member.comment ?? ""}
        </p>
      ) : null}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeSort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortState | null;
  onSort: (key: SortKey) => void;
  className: string;
}): React.ReactElement {
  const active = activeSort?.key === sortKey;
  const ariaSort = active
    ? activeSort.direction === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <span role="columnheader" aria-sort={ariaSort} className={className}>
      <button
        type="button"
        className={styles.sortButton}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className={styles.sortMark} aria-hidden>
          {active ? (activeSort.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </span>
  );
}

function TableView({
  members,
}: {
  members: readonly MemberSectionMember[];
}): React.ReactElement {
  const [sort, setSort] = React.useState<SortState | null>(null);
  const sortedMembers = React.useMemo(
    () => sortMembers(members, sort),
    [members, sort],
  );
  const defaultIndexMap = React.useMemo(() => {
    const map = new Map<string, number>();
    members.forEach((member, index) => map.set(member.id, index + 1));
    return map;
  }, [members]);
  const handleSort = React.useCallback((key: SortKey) => {
    setSort((current) => {
      if (key === "order") return null;
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }, []);

  return (
    <div
      className={`fn-table-scroll ${styles.tableWrap}`}
      role="table"
      aria-label="参加メンバー"
    >
      <div className={styles.tableHeader} role="row">
        <SortHeader label="No." sortKey="order" activeSort={sort} onSort={handleSort} className={styles.tColNo} />
        <SortHeader label="活動名" sortKey="name" activeSort={sort} onSort={handleSort} className={styles.tColName} />
        <SortHeader label="ID" sortKey="handle" activeSort={sort} onSort={handleSort} className={styles.tColHandle} />
        <SortHeader label="役割" sortKey="role" activeSort={sort} onSort={handleSort} className={styles.tColRole} />
        <span role="columnheader" className={styles.tColComment}>コメント</span>
      </div>
      {sortedMembers.map((member) => {
        const displayName = memberDisplayName(member);
        const iconUrl = cachedGoogleImageUrl(member.icon_url);
        return (
          <div className={styles.tableRow} role="row" key={member.id}>
            <span role="cell" className={styles.tColNo}>{defaultIndexMap.get(member.id)}</span>
            <span role="cell" className={styles.tColName}>
              <span className={styles.tNameCell}>
                <span className={styles.tAvatar} aria-hidden>
                  {iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={iconUrl} alt="" width={24} height={24} />
                  ) : (
                    <Icon name="user" size={12} aria-hidden />
                  )}
                </span>
                {member.x_user_id ? (
                  <Link href={`/user/${member.x_user_id}`} className={styles.tNameLink}>
                    <span className={styles.tName}>{displayName}</span>
                  </Link>
                ) : (
                  <span className={styles.tName}>{displayName}</span>
                )}
              </span>
            </span>
            <span role="cell" className={styles.tColHandle}>
              {member.x_user_id ? (
                <a href={`https://x.com/${encodeURIComponent(member.x_user_id)}`} target="_blank" rel="noopener noreferrer" className={styles.tHandleLink}>
                  @{member.x_user_id}
                </a>
              ) : (
                <span className={styles.tMuted}>—</span>
              )}
            </span>
            <span role="cell" className={styles.tColRole}>{member.role || <span className={styles.tMuted}>—</span>}</span>
            <span role="cell" className={styles.tColComment}>{member.comment || <span className={styles.tMuted}>—</span>}</span>
          </div>
        );
      })}
    </div>
  );
}
