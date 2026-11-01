import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { useLocation } from "react-router-dom";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { Icon } from "../../components/shared/Icon.js";
import { safeDecodeURIComponent } from "../../components/shared/url.js";
import { computeEventStatus } from "@flamenode/domain/event/status";
export function isManageHrefActive(href, pathname) {
    return href === "/manage" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}
export function filterManageEvents(events, query) {
    const q = query.trim().toLocaleLowerCase("ja");
    return q ? events.filter(ev => (ev.id + " " + ev.title).toLocaleLowerCase("ja").includes(q)) : [...events];
}
export function classifyManageEvent(ev, now = Math.floor(Date.now() / 1000)) {
    const status = computeEventStatus(ev, now);
    if (status === "active" || status === "published")
        return "active";
    if (status === "scheduled")
        return "scheduled";
    return "ended";
}
export function ManageSidebarNav({ events, showXLinkRequests, warnActiveX, activeX }) {
    const pathname = useLocation().pathname;
    const [query, setQuery] = React.useState("");
    const [recentIds, setRecentIds] = React.useState([]);
    // Keep the current browser-session ordering independent of optional localStorage.
    const recentIdsRef = React.useRef([]);
    React.useEffect(() => {
        try {
            const ids = JSON.parse(window.localStorage.getItem("flamenode:recent-manage-events") ?? "[]");
            const allowed = new Set(events.map(ev => ev.id));
            const recent = Array.isArray(ids) ? ids.filter((v) => typeof v === "string" && allowed.has(v)).slice(0, 5) : [];
            recentIdsRef.current = recent;
            setRecentIds(recent);
        }
        catch {
            // Storage may be disabled by a browser policy; the sidebar must still render.
            recentIdsRef.current = [];
            setRecentIds([]);
        }
    }, [events]);
    React.useEffect(() => {
        const match = pathname.match(/^\/manage\/events\/([^/]+)/);
        if (!match)
            return;
        const id = safeDecodeURIComponent(match[1]);
        if (!id || !events.some(ev => ev.id === id))
            return;
        const next = [id, ...recentIdsRef.current.filter(x => x !== id)].slice(0, 5);
        recentIdsRef.current = next;
        setRecentIds(next);
        // Do not perform browser I/O inside a React state updater. Storage access or
        // writes can throw SecurityError/QuotaExceededError (private mode/policy).
        try {
            window.localStorage.setItem("flamenode:recent-manage-events", JSON.stringify(next));
        }
        catch {
            // Recent history is optional; permissions always come from the event DTO.
        }
    }, [events, pathname]);
    const filtered = filterManageEvents(events, query);
    const categories = [
        { label: "最近", rows: recentIds.map(id => filtered.find(ev => ev.id === id)).filter((ev) => Boolean(ev)) },
        { label: "開催中・公開中", rows: filtered.filter(ev => classifyManageEvent(ev) === "active") },
        { label: "開始前", rows: filtered.filter(ev => classifyManageEvent(ev) === "scheduled") },
        { label: "終了", rows: filtered.filter(ev => classifyManageEvent(ev) === "ended") },
    ];
    return _jsxs("section", { className: "adminnav-navGroup console-manage-nav", "aria-label": "\u30A4\u30D9\u30F3\u30C8\u904B\u55B6\u30CA\u30D3", children: [_jsx("h2", { className: "adminnav-navGroupTitle", children: "\u30A4\u30D9\u30F3\u30C8\u904B\u55B6" }), warnActiveX ? _jsxs("p", { className: "console-sidebar-warn", children: ["\u904B\u55B6\u6A29\u9650\u306F\u627F\u8A8D\u6E08\u307F X ID \u5168\u4F53\u3067\u5224\u5B9A\u3055\u308C\u307E\u3059\u3002\u6295\u7A3F\u4E3B\u4F53\u306F Active X ID ", activeX ? " (@" + activeX + ")" : "（未選択）", " \u3067\u3059\u3002"] }) : null, _jsxs(Link, { href: "/manage", className: "adminnav-navLink" + (isManageHrefActive("/manage", pathname) ? " adminnav-navLinkActive" : ""), "aria-current": isManageHrefActive("/manage", pathname) ? "page" : undefined, children: [_jsx(Icon, { name: "grid", size: 14, "aria-hidden": true }), _jsx("span", { className: "console-sidebar-link-label", children: "\u904B\u55B6\u30C8\u30C3\u30D7" })] }), showXLinkRequests ? _jsxs(Link, { href: "/manage/x-link-requests", className: "adminnav-navLink" + (isManageHrefActive("/manage/x-link-requests", pathname) ? " adminnav-navLinkActive" : ""), "aria-current": isManageHrefActive("/manage/x-link-requests", pathname) ? "page" : undefined, children: [_jsx(Icon, { name: "user", size: 14, "aria-hidden": true }), _jsx("span", { className: "console-sidebar-link-label", children: "X ID \u9023\u643A\u7533\u8ACB" })] }) : null, _jsxs("label", { className: "console-sidebar-search", children: [_jsx(Icon, { name: "search", size: 13, "aria-hidden": true }), _jsx("span", { className: "fn-sr-only", children: "\u30A4\u30D9\u30F3\u30C8\u3092\u691C\u7D22" }), _jsx("input", { type: "search", value: query, onChange: e => setQuery(e.target.value), placeholder: "\u30A4\u30D9\u30F3\u30C8\u540D\u30FBID" })] }), categories.map(cat => cat.rows.length ? _jsxs("div", { className: "console-sidebar-event-group", children: [_jsx("h3", { className: "console-sidebar-event-group-title", children: cat.label }), cat.rows.map(ev => {
                        const href = "/manage/events/" + encodeURIComponent(ev.id);
                        const active = isManageHrefActive(href, pathname);
                        return _jsxs(Link, { href: href, className: "adminnav-navLink" + (active ? " adminnav-navLinkActive" : ""), "aria-current": active ? "page" : undefined, style: ev.accent_color ? { "--event-accent": ev.accent_color } : undefined, children: [_jsx("span", { className: "console-sidebar-event-dot", "aria-hidden": true }), _jsx("span", { className: "console-sidebar-link-label", children: ev.title }), ev.pending_review_count > 0 ? _jsx("span", { className: "console-sidebar-count", children: ev.pending_review_count }) : null] }, ev.id);
                    })] }, cat.label) : null), events.length === 0 ? _jsx("p", { className: "console-sidebar-empty", children: "\u62C5\u5F53\u30A4\u30D9\u30F3\u30C8\u304C\u5272\u308A\u5F53\u3066\u3089\u308C\u308B\u3068\u3001\u3053\u3053\u306B\u4E00\u89A7\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002" }) : null] });
}
