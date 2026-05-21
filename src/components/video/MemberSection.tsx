"use client";

import * as React from "react";
import Link from "next/link";
import styles from "./MemberSection.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { ChapterCommentItem } from "./ChapterCommentItem";
import type { ChapterCommentItemEntry } from "./ChapterCommentItem";

/**
 * 動画詳細ページ「参加メンバー」セクション。
 * 旧 MemberList を以下 3 モードで切り替え可能に拡張する。
 *   - cards: 丸アイコン + 名前 + 役割の縦カード (デフォルト, 旧表示)
 *   - table: シンプルなテーブル風 (fn-table は使わない — CLAUDE.md 方針)
 *   - chapters: メンバーごとに video_chapters.video_member_id でグループ化したチャプター表示
 *
 * 仕様メモ:
 *   - 表示モードはクライアント状態 (URLに永続化しない) — 1作品内の一時切替なので state で十分。
 *   - chapters モードは「担当チャプターが 1 件もないメンバーも全員表示する」。空の場合は "担当チャプターなし" を出す。
 *   - chapters モードで video_member_id が NULL のチャプターは "担当未割当" グループにまとめる。
 *   - クリックで onSeek を呼ぶことで動画シークと連携できる (省略時は静的表示)。
 */

export interface MemberSectionMember {
  id: string;
  x_user_id: string | null;
  name: string | null;
  role: string | null;
  comment: string | null;
  x_name: string | null;
  icon_url: string | null;
}

export interface MemberSectionChapter extends ChapterCommentItemEntry {
  video_member_id: string | null;
}

interface MemberSectionProps {
  members: readonly MemberSectionMember[];
  /** chapters モード用。未指定なら chapters タブを描画しない。 */
  chapters?: readonly MemberSectionChapter[];
  duration?: number | null;
  onSeek?: (time: number) => void;
}

type ViewMode = "cards" | "table" | "chapters";

export function MemberSection({
  members,
  chapters,
  duration,
  onSeek,
}: MemberSectionProps): React.ReactElement | null {
  const [mode, setMode] = React.useState<ViewMode>("cards");
  const hasChapters = Array.isArray(chapters) && chapters.length > 0;

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
        {hasChapters ? (
          <TabButton
            icon="chapter"
            label="担当チャプター"
            active={mode === "chapters"}
            onClick={() => setMode("chapters")}
          />
        ) : null}
      </div>

      {mode === "cards" ? <CardsView members={members} /> : null}
      {mode === "table" ? <TableView members={members} /> : null}
      {mode === "chapters" && hasChapters ? (
        <ChaptersView
          members={members}
          chapters={chapters ?? []}
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
      {members.map((m) => (
        <li key={m.id}>
          <MemberCard member={m} />
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
    ? `https://x.com/${member.x_user_id}`
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

function TableView({
  members,
}: {
  members: readonly MemberSectionMember[];
}): React.ReactElement {
  return (
    <div className={styles.tableWrap} role="table">
      <div className={styles.tableHeader} role="row">
        <span role="columnheader" className={styles.tColMember}>
          メンバー
        </span>
        <span role="columnheader" className={styles.tColRole}>
          役割
        </span>
        <span role="columnheader" className={styles.tColComment}>
          コメント
        </span>
      </div>
      {members.map((m) => {
        const displayName = m.x_name ?? m.name ?? "anonymous";
        const internalHref = m.x_user_id ? `/user/${m.x_user_id}` : null;
        return (
          <div role="row" key={m.id} className={styles.tableRow}>
            <span role="cell" className={styles.tColMember}>
              {internalHref ? (
                <Link href={internalHref} className={styles.tNameLink}>
                  <span className={styles.tAvatar} aria-hidden>
                    {m.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.icon_url} alt="" width={24} height={24} />
                    ) : (
                      <Icon name="user" size={11} aria-hidden />
                    )}
                  </span>
                  <span className={styles.tName}>{displayName}</span>
                </Link>
              ) : (
                <span className={styles.tNameLink}>
                  <span className={styles.tAvatar} aria-hidden>
                    {m.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.icon_url} alt="" width={24} height={24} />
                    ) : (
                      <Icon name="user" size={11} aria-hidden />
                    )}
                  </span>
                  <span className={styles.tName}>{displayName}</span>
                </span>
              )}
            </span>
            <span role="cell" className={styles.tColRole}>
              {m.role ?? ""}
            </span>
            <span role="cell" className={styles.tColComment}>
              {m.comment ?? ""}
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
  // video_member_id -> chapters の Map
  const grouped = React.useMemo(() => {
    const map = new Map<string, MemberSectionChapter[]>();
    for (const c of chapters) {
      const key = c.video_member_id ?? "__unassigned__";
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.chapter_time - b.chapter_time);
    }
    return map;
  }, [chapters]);

  const unassigned = grouped.get("__unassigned__") ?? [];

  return (
    <div className={styles.chaptersWrap}>
      {members.map((m) => {
        const list = grouped.get(m.id) ?? [];
        const displayName = m.x_name ?? m.name ?? "anonymous";
        return (
          <section key={m.id} className={styles.chapterGroup}>
            <header className={styles.chapterGroupHead}>
              <span className={styles.avatarSmall} aria-hidden>
                {m.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.icon_url} alt="" width={24} height={24} />
                ) : (
                  <Icon name="user" size={11} aria-hidden />
                )}
              </span>
              <span className={styles.chapterGroupName}>{displayName}</span>
              {m.role ? (
                <span className={styles.chapterGroupRole}>{m.role}</span>
              ) : null}
              <span className={styles.chapterGroupCount}>{list.length}</span>
            </header>
            {list.length === 0 ? (
              <div className={styles.chapterGroupEmpty}>担当チャプターなし</div>
            ) : (
              <div className={styles.chapterGroupList}>
                {list.map((c, i) => (
                  <ChapterCommentItem
                    key={`${c.id}-mem-${i}`}
                    chapter={c}
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
            <span className={styles.chapterGroupName}>担当未割当</span>
            <span className={styles.chapterGroupCount}>
              {unassigned.length}
            </span>
          </header>
          <div className={styles.chapterGroupList}>
            {unassigned.map((c, i) => (
              <ChapterCommentItem
                key={`${c.id}-un-${i}`}
                chapter={c}
                duration={duration}
                showAuthor
                onSeek={onSeek}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
