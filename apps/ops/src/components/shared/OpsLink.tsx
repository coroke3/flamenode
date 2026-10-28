// MIG-0707 U05: preserve SPA-local navigation; leave Personal/public/external URLs as documents.
import * as React from "react";
import { Link } from "react-router-dom";

export function OpsLink({ href, className, children, "aria-current": current }: {
  href: string;
  className?: string;
  children: React.ReactNode;
  "aria-current"?: "page";
}): React.ReactElement {
  const local = /^(?:\/admin|\/manage)(?:\/|$)/.test(href);
  return local
    ? <Link to={href} className={className} aria-current={current}>{children}</Link>
    : <a href={href} className={className} aria-current={current}>{children}</a>;
}
