"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./MemberSection.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";
import { MemberChapterItem } from "./MemberChapterItem";
import type { MemberChapterItemEntry } from "./MemberChapterItem";

export interface MemberSectionMember {
  id: string;
  x_user_id: string | null;
  name: string | null;
  role: string | null;
  comment: string | null;
  x_name: string | null;
  icon_url: string | null;
}

export interface MemberSectionChapter extends MemberChapterItemEntry {
  video_member_id: string;
}

interface MemberSectionProps {
  members: readonly MemberSectionMember[];
  memberChapters?: readonly MemberSectionChapter[];
  duration?: number | null;
  onSeek?: (time: number) => void;
}

type ViewMode = "cards" | "table" | "chapters";
type SortKey = "order" | "name" | "handle" | "role" | "chapters";
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

function chapterCountMap(
  chapters: readonly MemberSectionChapter[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const chapter of chapters) {
    if (!chapter.video_member_id) continue;
    map.set(
      chapter.video_member_id,
      (map.get(chapter.video_member_id) ?? 0) + 1,
    );
  }
  return map;
}

function chapterTimesMap(
  chapters: readonly MemberSectionChapter[],
): Map<string, string[]> {
  const map = new Map<string, number[]>();
  for (const chapter of chapters) {
    if (!chapter.video_member_id) continue;
    const list = map.get(chapter.video_member_id) ?? [];
    list.push(chapter.chapter_time);
    map.set(chapter.video_member_id, list);
  }
  return new Map(
    Array.from(map.entries()).map(([id, times]) => [
      id,
      times.sort((a, b) => a - b).map((time) => formatDuration(time)),
    ]),
  );
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
  counts: Map<string, number>,
): MemberSectionMember[] {
  const withIndex = members.map((member, index) => ({ member, index }));
  if (!sort) return withIndex.map((entry) => entry.member);

  const direction = sort.direction === "asc" ? 1 : -1;
  withIndex.sort((a, b) => {
    let result = 0;
    if (sort.key === "order") {
      result = a.index - b.index;
    } else if (sort.key === "name") {
      result = compareText(memberDisplayName(a.member), memberDisplayName(b.member));
    } else if (sort.key === "handle") {
      result = compareText(memberHandle(a.member), memberHandle(b.member));
    } else if (sort.key === "role") {
      result = compareText(a.member.role, b.member.role);
    } else {
      result = (counts.get(a.member.id) ?? 0) - (counts.get(b.member.id) ?? 0);
    }
    return result === 0 ? a.index - b.index : result * direction;
  });

  return withIndex.map((entry) => entry.member);
}

export function MemberSection({
  members,
  memberChapters,
  duration,
  onSeek,
}: MemberSectionProps): React.ReactElement | null {
  const [mode, setMode] = React.useState<ViewMode>("cards");
  const chapters = memberChapters ?? [];
  const hasMemberChapters = chapters.length > 0;

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
        {hasMemberChapters ? (
          <TabButton
            icon="chapter"
            label="メンバーチャプター"
            active={mode === "chapters"}
            onClick={() => setMode("chapters")}
          />
        ) : null}
      </div>

      {mode === "cards" ? <CardsView members={members} /> : null}
      {mode === "table" ? (
        <TableView members={members} memberChapters={chapters} />
      ) : null}
      {mode === "chapters" && hasMemberChapters ? (
        <ChaptersView
          members={members}
          chapters={chapters}
          duration={duration}
          onSeek={onSeek}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: "users" | "list" | "chapter";
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

  const avatar = (
    <span className={styles.avatar} aria-hidden>
      {member.icon_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.icon_url} alt="" width={36} height={36} />
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
  memberChapters,
}: {
  members: readonly MemberSectionMember[];
  memberChapters: readonly MemberSectionChapter[];
}): React.ReactElement {
  const [sort, setSort] = React.useState<SortState | null>(null);
  const counts = React.useMemo(
    () => chapterCountMap(memberChapters),
    [memberChapters],
  );
  const chapterTimes = React.useMemo(
    () => chapterTimesMap(memberChapters),
    [memberChapters],
  );
  const sortedMembers = React.useMemo(
    () => sortMembers(members, sort, counts),
    [members, sort, counts],
  );

  const handleSort = React.useCallback((key: SortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }, []);

  return (
    <div className={styles.tableWrap} role="table" aria-label="参加メンバー">
      <div className={styles.tableHeader} role="row">
        <SortHeader
          label="活動名"
          sortKey="name"
          activeSort={sort}
          onSort={handleSort}
          className={styles.tColName}
        />
        <SortHeader
          label="ID"
          sortKey="handle"
          activeSort={sort}
          onSort={handleSort}
          className={styles.tColHandle}
        />
        <SortHeader
          label="チャプター"
          sortKey="chapters"
          activeSort={sort}
          onSort={handleSort}
          className={styles.tColChapters}
        />
        <SortHeader
          label="役割"
          sortKey="role"
          activeSort={sort}
          onSort={handleSort}
          className={styles.tColRole}
        />
        <span role="columnheader" className={styles.tColComment}>
          コメント
        </span>
      </div>
      {sortedMembers.map((member) => {
        const displayName = memberDisplayName(member);
        const internalHref = member.x_user_id ? `/user/${member.x_user_id}` : null;
        const externalHref = member.x_user_id
          ? `https://x.com/${encodeURIComponent(member.x_user_id)}`
          : null;
        const times = chapterTimes.get(member.id) ?? [];

        return (
          <div role="row" key={member.id} className={styles.tableRow}>
            <span role="cell" className={styles.tColName} data-label="活動名">
              <span className={styles.tNameCell}>
                <span className={styles.tAvatar} aria-hidden>
                  {member.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={member.icon_url} alt="" width={24} height={24} />
                  ) : (
                    <Icon name="user" size={11} aria-hidden />
                  )}
                </span>
                {internalHref ? (
                  <Link href={internalHref} className={styles.tNameLink}>
                    <span className={styles.tName}>{displayName}</span>
                  </Link>
                ) : (
                  <span className={styles.tName}>{displayName}</span>
                )}
              </span>
            </span>
            <span role="cell" className={styles.tColHandle} data-label="ID">
              {externalHref ? (
                <a
                  href={externalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.tHandleLink}
                >
                  @{member.x_user_id}
                  <Icon name="external" size={10} aria-hidden />
                </a>
              ) : (
                <span className={styles.tMuted}>—</span>
              )}
            </span>
            <span
              role="cell"
              className={styles.tColChapters}
              data-label="チャプター"
            >
              {times.length > 0 ? (
                <span className={styles.chapterTimes}>{times.join(" / ")}</span>
              ) : (
                <span className={styles.tMuted}>—</span>
              )}
            </span>
            <span role="cell" className={styles.tColRole} data-label="役割">
              {member.role ?? <span className={styles.tMuted}>—</span>}
            </span>
            <span
              role="cell"
              className={styles.tColComment}
              data-label="コメント"
            >
              {member.comment ?? <span className={styles.tMuted}>—</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ChaptersView({
  members,
  chapters,
  duration,
  onSeek,
}: {
  members: readonly MemberSectionMember[];
  chapters: readonly MemberSectionChapter[];
  duration?: number | null;
  onSeek?: (time: number) => void;
}): React.ReactElement {
  const grouped = React.useMemo(() => {
    const map = new Map<string, MemberSectionChapter[]>();
    for (const chapter of chapters) {
      const key = chapter.video_member_id || "__unassigned__";
      const list = map.get(key) ?? [];
      list.push(chapter);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.chapter_time - b.chapter_time);
    }
    return map;
  }, [chapters]);

  const unassigned = grouped.get("__unassigned__") ?? [];

  return (
    <div className={styles.chaptersWrap}>
      {members.map((member) => {
        const list = grouped.get(member.id) ?? [];
        const displayName = memberDisplayName(member);
        const headerLabel = member.x_user_id
          ? `${displayName}(@${member.x_user_id})`
          : displayName;

        return (
          <section key={member.id} className={styles.chapterGroup}>
            <header className={styles.chapterGroupHead}>
              <span className={styles.avatarSmall} aria-hidden>
                {member.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.icon_url} alt="" width={24} height={24} />
                ) : (
                  <Icon name="user" size={11} aria-hidden />
                )}
              </span>
              <span className={styles.chapterGroupName}>{headerLabel}</span>
              {member.role ? (
                <span className={styles.chapterGroupRole}>{member.role}</span>
              ) : null}
              <span className={styles.chapterGroupCount}>{list.length}</span>
            </header>
            {list.length === 0 ? (
              <div className={styles.chapterGroupEmpty}>
                メンバーチャプターなし
              </div>
            ) : (
              <div className={styles.chapterGroupList}>
                {list.map((chapter, index) => (
                  <MemberChapterItem
                    key={`${chapter.id}-member-${index}`}
                    chapter={chapter}
                    duration={duration}
                    onSeek={onSeek}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {unassigned.length > 0 ? (
        <section className={styles.chapterGroup}>
          <header className={styles.chapterGroupHead}>
            <span className={styles.avatarSmall} aria-hidden>
              <Icon name="user" size={11} aria-hidden />
            </span>
            <span className={styles.chapterGroupName}>未割当</span>
            <span className={styles.chapterGroupCount}>
              {unassigned.length}
            </span>
          </header>
          <div className={styles.chapterGroupList}>
            {unassigned.map((chapter, index) => (
              <MemberChapterItem
                key={`${chapter.id}-unassigned-${index}`}
                chapter={chapter}
                duration={duration}
                onSeek={onSeek}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
