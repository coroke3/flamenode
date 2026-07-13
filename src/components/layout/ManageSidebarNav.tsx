"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  classifyManageEvent,
  filterManageEvents,
} from "@/lib/manage/sidebarEvents";
import navStyles from "@/components/admin/AdminSidebarNav.module.css";

export type ManageSidebarEvent = {
  id: string;
  title: string;
  accent_color: string | null;
  visibility_status: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  pending_review_count: number;
};

export interface ManageSidebarNavProps {
  events: ManageSidebarEvent[];
  showXLinkRequests: boolean;
  warnActiveX: boolean;
  activeX: string | null;
}

function isManageHrefActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/manage") return pathname === "/manage";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function EventLink({
  event,
  pathname,
}: {
  event: ManageSidebarEvent;
  pathname: string | null;
}): React.ReactElement {
  const href = `/manage/events/${event.id}`;
  const active = isManageHrefActive(href, pathname);
  return (
    <Link
      href={href}
      className={`${navStyles.navLink} ${active ? navStyles.navLinkActive : ""}`}
      aria-current={active ? "page" : undefined}
      title={event.title}
      style={
        event.accent_color
          ? ({ "--event-accent": event.accent_color } as React.CSSProperties)
          : undefined
      }
      data-event-link="true"
    >
      <span className="console-sidebar-event-dot" aria-hidden />
      <span className="console-sidebar-link-label">{event.title}</span>
      {event.pending_review_count > 0 ? (
        <span className="console-sidebar-count">
          {event.pending_review_count}
        </span>
      ) : null}
    </Link>
  );
}

function EventGroup({
  title,
  events,
  pathname,
  collapsible = false,
}: {
  title: string;
  events: ManageSidebarEvent[];
  pathname: string | null;
  collapsible?: boolean;
}): React.ReactElement | null {
  if (events.length === 0) return null;

  const body = events.map((event) => (
    <EventLink key={event.id} event={event} pathname={pathname} />
  ));

  if (!collapsible) {
    return (
      <div className="console-sidebar-event-group">
        <h3 className="console-sidebar-event-group-title">{title}</h3>
        {body}
      </div>
    );
  }

  return (
    <details className="console-sidebar-event-group">
      <summary className="console-sidebar-event-group-title">{title}</summary>
      {body}
    </details>
  );
}

export function ManageSidebarNav({
  events,
  showXLinkRequests,
  warnActiveX,
  activeX,
}: ManageSidebarNavProps): React.ReactElement {
  const pathname = usePathname();
  const [query, setQuery] = React.useState("");
  const [recentIds, setRecentIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    try {
      const value = JSON.parse(
        window.localStorage.getItem(
          "flamenode:recent-manage-events",
        ) ?? "[]",
      );

      const allowed =
        new Set(events.map((event) => event.id));

      setRecentIds(
        Array.isArray(value)
          ? value
              .filter(
                (id): id is string =>
                  typeof id === "string" &&
                  allowed.has(id),
              )
              .slice(0, 5)
          : [],
      );
    } catch {
      setRecentIds([]);
    }
  }, [events]);

  React.useEffect(() => {
    const match =
      pathname?.match(
        /^\/manage\/events\/([^/]+)/,
      );

    if (!match) return;

    const eventId =
      decodeURIComponent(match[1]);

    const available =
      new Set(events.map((event) => event.id));

    if (!available.has(eventId)) return;

    setRecentIds((current) => {
      const next = [
        eventId,
        ...current.filter(
          (id) => id !== eventId,
        ),
      ].slice(0, 5);

      window.localStorage.setItem(
        "flamenode:recent-manage-events",
        JSON.stringify(next),
      );

      return next;
    });
  }, [pathname, events]);

  const filtered =
    filterManageEvents(events, query);

  const recent =
    recentIds
      .map((id) =>
        filtered.find(
          (event) => event.id === id,
        ),
      )
      .filter(
        (
          event,
        ): event is ManageSidebarEvent =>
          Boolean(event),
      );

  const active = filtered.filter(
    (event) =>
      classifyManageEvent(event) ===
      "active",
  );

  const scheduled = filtered.filter(
    (event) =>
      classifyManageEvent(event) ===
      "scheduled",
  );

  const ended = filtered.filter(
    (event) =>
      classifyManageEvent(event) ===
      "ended",
  );

  return (
    <section
      className={`${navStyles.navGroup} console-manage-nav`}
      aria-label="イベント運営ナビ"
    >
      <h2 className={navStyles.navGroupTitle}>イベント運営</h2>
      {warnActiveX ? (
        <p className="console-sidebar-warn">
          運営権限は承認済み X ID 全体で判定されます。投稿主体は Active X ID
          {activeX ? ` (@${activeX})` : "（未選択）"}
          です。
        </p>
      ) : null}

      <Link
        href="/manage"
        className={`${navStyles.navLink} ${isManageHrefActive("/manage", pathname) ? navStyles.navLinkActive : ""}`}
        aria-current={isManageHrefActive("/manage", pathname) ? "page" : undefined}
      >
        <Icon name="grid" size={14} aria-hidden />
        <span className="console-sidebar-link-label">運営トップ</span>
      </Link>

      {showXLinkRequests ? (
        <Link
          href="/manage/x-link-requests"
          className={`${navStyles.navLink} ${isManageHrefActive("/manage/x-link-requests", pathname) ? navStyles.navLinkActive : ""}`}
          aria-current={isManageHrefActive("/manage/x-link-requests", pathname) ? "page" : undefined}
        >
          <Icon name="user" size={14} aria-hidden />
          <span className="console-sidebar-link-label">X ID 連携申請</span>
        </Link>
      ) : null}

      <label className="console-sidebar-search">
        <Icon
          name="search"
          size={13}
          aria-hidden
        />
        <span className="fn-sr-only">
          イベントを検索
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
          placeholder="イベント名・ID"
        />
      </label>

      <EventGroup title="最近" events={recent} pathname={pathname} />
      <EventGroup title="開催中・公開中" events={active} pathname={pathname} />
      <EventGroup title="開始前" events={scheduled} pathname={pathname} />
      <EventGroup title="終了" events={ended} pathname={pathname} collapsible />

      {events.length === 0 ? (
        <p className="console-sidebar-empty">担当イベントが割り当てられると、ここに一覧が表示されます。</p>
      ) : null}
    </section>
  );
}
