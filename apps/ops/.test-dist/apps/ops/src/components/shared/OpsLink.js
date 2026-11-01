import { jsx as _jsx } from "react/jsx-runtime";
import { Link } from "react-router-dom";
export function OpsLink({ href, className, children, "aria-current": current, "aria-label": label, style }) {
    const props = { className, "aria-current": current, "aria-label": label, style, children };
    const local = /^\/(?:admin|manage)(?:\/|[?#]|$)/.test(href);
    return local ? _jsx(Link, { to: href, ...props }) : _jsx("a", { href: href, ...props });
}
