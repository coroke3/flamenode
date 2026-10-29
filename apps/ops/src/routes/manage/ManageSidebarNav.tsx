import * as React from "react";
import { useLocation } from "react-router-dom";
import type { ManageNavigationEvent } from "@flamenode/contracts";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { Icon } from "../../components/shared/Icon.js";
import { safeDecodeURIComponent } from "../../components/shared/url.js";

export function isManageHrefActive(href: string, pathname: string): boolean {
  return href === "/manage" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}
export function filterManageEvents(events: readonly ManageNavigationEvent[], query: string): ManageNavigationEvent[] {
  const q = query.trim().toLocaleLowerCase("ja");
  return q ? events.filter(ev => (ev.id + " " + ev.title).toLocaleLowerCase("ja").includes(q)) : [...events];
}
export function classifyManageEvent(ev: ManageNavigationEvent, now = Math.floor(Date.now() / 1000)): "active" | "scheduled" | "ended" {
  // Presentation only. The backend remains the authority for current event/entry permissions.
  if (ev.end_time !== null && ev.end_time < now) return "ended";
  if (ev.start_time !== null && ev.start_time > now) return "scheduled";
  return "active";
}
export function ManageSidebarNav({ events, showXLinkRequests, warnActiveX, activeX }: {
  events: ManageNavigationEvent[]; showXLinkRequests: boolean; warnActiveX: boolean; activeX: string | null;
}): React.ReactElement {
  const pathname = useLocation().pathname;
  const [query, setQuery] = React.useState("");
  const [recentIds, setRecentIds] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      const ids: unknown = JSON.parse(window.localStorage.getItem("flamenode:recent-manage-events") ?? "[]");
      const allowed = new Set(events.map(ev => ev.id));
      setRecentIds(Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string" && allowed.has(v)).slice(0, 5) : []);
    } catch { setRecentIds([]); }
  }, [events]);
  React.useEffect(() => {
    const match = pathname.match(/^\/manage\/events\/([^/]+)/);
    if (!match) return;
    const id = safeDecodeURIComponent(match[1]);
    if (!id || !events.some(ev => ev.id === id)) return;
    setRecentIds(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, 5);
      window.localStorage.setItem("flamenode:recent-manage-events", JSON.stringify(next));
      return next;
    });
  }, [events, pathname]);
  const filtered = filterManageEvents(events, query);
  const categories = [
    { label: "最近", rows: recentIds.map(id => filtered.find(ev => ev.id === id)).filter((ev): ev is ManageNavigationEvent => Boolean(ev)) },
    { label: "開催中・公開中", rows: filtered.filter(ev => classifyManageEvent(ev) === "active") },
    { label: "開始前", rows: filtered.filter(ev => classifyManageEvent(ev) === "scheduled") },
    { label: "終了", rows: filtered.filter(ev => classifyManageEvent(ev) === "ended") },
  ];
  return <section className="adminnav-navGroup console-manage-nav" aria-label="イベント運営ナビ">
    <h2 className="adminnav-navGroupTitle">イベント運営</h2>
    {warnActiveX ? <p className="console-sidebar-warn">運営権限は承認済み X ID 全体で判定されます。投稿主体は Active X ID {activeX ? " (@" + activeX + ")" : "（未選択）"} です。</p> : null}
    <Link href="/manage" className={"adminnav-navLink" + (isManageHrefActive("/manage", pathname) ? " adminnav-navLinkActive" : "")} aria-current={isManageHrefActive("/manage", pathname) ? "page" : undefined}><Icon name="grid" size={14} aria-hidden /><span className="console-sidebar-link-label">運営トップ</span></Link>
    {showXLinkRequests ? <Link href="/manage/x-link-requests" className={"adminnav-navLink" + (isManageHrefActive("/manage/x-link-requests", pathname) ? " adminnav-navLinkActive" : "")} aria-current={isManageHrefActive("/manage/x-link-requests", pathname) ? "page" : undefined}><Icon name="user" size={14} aria-hidden /><span className="console-sidebar-link-label">X ID 連携申請</span></Link> : null}
    <label className="console-sidebar-search"><Icon name="search" size={13} aria-hidden /><span className="fn-sr-only">イベントを検索</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="イベント名・ID" /></label>
    {categories.map(cat => cat.rows.length ? <div className="console-sidebar-event-group" key={cat.label}><h3 className="console-sidebar-event-group-title">{cat.label}</h3>
      {cat.rows.map(ev => { const href = "/manage/events/" + encodeURIComponent(ev.id); const active = isManageHrefActive(href, pathname);
        return <Link key={ev.id} href={href} className={"adminnav-navLink" + (active ? " adminnav-navLinkActive" : "")} aria-current={active ? "page" : undefined} style={ev.accent_color ? { "--event-accent": ev.accent_color } as React.CSSProperties : undefined}><span className="console-sidebar-event-dot" aria-hidden /><span className="console-sidebar-link-label">{ev.title}</span>{ev.pending_review_count > 0 ? <span className="console-sidebar-count">{ev.pending_review_count}</span> : null}</Link>;
      })}</div> : null)}
    {events.length === 0 ? <p className="console-sidebar-empty">担当イベントが割り当てられると、ここに一覧が表示されます。</p> : null}
  </section>;
}
