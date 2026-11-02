import { jsx as _jsx } from "react/jsx-runtime";
import { Navigate, useLocation } from "react-router-dom";
/** Reproduce CURRENT's five server redirects without emitting double-encoded IDs. */
export function adminCompatTarget(pathname) {
    if (pathname === "/admin/history" || pathname === "/admin/history/")
        return "/admin/audit";
    const match = /^\/admin\/events\/([^/]+)(?:\/(edit|slots|staff))?\/?$/.exec(pathname);
    if (!match)
        return null;
    try {
        const id = decodeURIComponent(match[1]);
        if (!id)
            return null;
        // CURRENT app/(admin)/admin/events/{new,templates}/page.tsx are static pages that win over [id].
        if (!match[2] && (id === "new" || id === "templates"))
            return null;
        const encoded = encodeURIComponent(id);
        return "/manage/events/" + encoded + (match[2] ? "/" + match[2] : "");
    }
    catch {
        return null;
    }
}
/** Mount on each of five exact old paths; any other path renders nothing (the 404 route owns it). */
export function AdminCompatRedirect() {
    const { pathname } = useLocation();
    const target = adminCompatTarget(pathname);
    return target ? _jsx(Navigate, { replace: true, to: target }) : null;
}
