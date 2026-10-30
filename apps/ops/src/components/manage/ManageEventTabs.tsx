import * as React from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Icon, type IconName } from "../shared/Icon.js";
import { OpsLink as Link } from "../shared/OpsLink.js";
import { ManageEventMoreMenu } from "./ManageEventMoreMenu.js";

type NavKey = "overview" | "pending" | "content" | "settings";
interface Props { eventId: string; isAdmin?: boolean; pendingCount?: number; }

const PRIMARY_ITEMS: Array<{
  key: NavKey; label: string; icon: IconName; href: (id: string) => string;
}> = [
  { key: "overview", label: "概要", icon: "grid", href: id => `/manage/events/${id}` },
  { key: "pending", label: "対応待ち", icon: "check", href: id => `/manage/events/${id}/videos?status=pending` },
  { key: "content", label: "参加者・作品", icon: "list", href: id => `/manage/events/${id}/videos?status=all` },
  { key: "settings", label: "設定", icon: "settings", href: id => `/manage/events/${id}/edit` },
];

/** Same pathname/query precedence as CURRENT resolveManageEventNav. */
export function resolveManageEventNav(input: {
  pathname: string; searchParams: URLSearchParams; eventId: string;
}): NavKey {
  const base = `/manage/events/${encodeURIComponent(input.eventId)}`;
  if (input.pathname === base || input.pathname === `${base}/`) return "overview";
  if (input.pathname.startsWith(`${base}/videos`)) {
    return input.searchParams.get("status") === "pending" ? "pending" : "content";
  }
  if (input.pathname.startsWith(`${base}/slots`) || input.pathname.startsWith(`${base}/audience`)) return "content";
  if (input.pathname.startsWith(`${base}/staff`) || input.pathname.startsWith(`${base}/edit`) || input.pathname.startsWith(`${base}/youtube-playlist`)) return "settings";
  return "overview";
}

/** Port of CURRENT ManageEventTabs (URLs, aria-current, sub-tabs, pending badge). */
export function ManageEventTabs({ eventId, isAdmin = false, pendingCount }: Props): React.ReactElement {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const encodedId = encodeURIComponent(eventId);
  const active = resolveManageEventNav({ pathname, searchParams, eventId });
  const contentSubtab = pathname.endsWith("/slots") ? "slots" : pathname.endsWith("/audience") ? "audience" : "videos";
  const settingsSubtab = pathname.endsWith("/youtube-playlist") ? "youtube-playlist" : pathname.endsWith("/staff") ? "staff" : "edit";
  return (
    <div className="fn-console-event-nav">
      <nav className="fn-console-event-tabs" aria-label="イベント運営メニュー">
        {PRIMARY_ITEMS.map(item => {
          const selected = item.key === active;
          return (
            <Link key={item.key} href={item.href(encodedId)} className={selected ? "is-active" : undefined}
              aria-current={selected ? "page" : undefined}>
              <Icon name={item.icon} size={12} aria-hidden />
              {item.label}
              {item.key === "pending" && pendingCount != null && pendingCount > 0
                ? <span className="fn-console-event-tab-count">{pendingCount}</span> : null}
            </Link>
          );
        })}
      </nav>
      {active === "content" ? (
        <nav className="fn-console-event-subtabs" aria-label="参加者・作品">
          <Link href={`/manage/events/${encodedId}/videos?status=all`} aria-current={contentSubtab === "videos" ? "page" : undefined}>提出状況</Link>
          <Link href={`/manage/events/${encodedId}/slots`} aria-current={contentSubtab === "slots" ? "page" : undefined}>枠管理</Link>
          <Link href={`/manage/events/${encodedId}/audience`} aria-current={contentSubtab === "audience" ? "page" : undefined}>登録者プレビュー</Link>
        </nav>
      ) : null}
      {active === "settings" ? (
        <nav className="fn-console-event-subtabs" aria-label="設定">
          <Link href={`/manage/events/${encodedId}/edit`} aria-current={settingsSubtab === "edit" ? "page" : undefined}>イベント設定</Link>
          <Link href={`/manage/events/${encodedId}/youtube-playlist`} aria-current={settingsSubtab === "youtube-playlist" ? "page" : undefined}>YouTube再生リスト</Link>
          <Link href={`/manage/events/${encodedId}/staff`} aria-current={settingsSubtab === "staff" ? "page" : undefined}>運営メンバー</Link>
        </nav>
      ) : null}
      <ManageEventMoreMenu eventId={eventId} isAdmin={isAdmin} />
    </div>
  );
}
