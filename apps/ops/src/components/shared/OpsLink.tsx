// MIG-0707 U05: preserve Ops SPA navigation; use document links outside its route space.
import * as React from "react";
import { Link } from "react-router-dom";

type OpsLinkProps = {
  href: string;
  className?: string;
  children?: React.ReactNode;
  "aria-current"?: React.AriaAttributes["aria-current"];
  "aria-label"?: string;
  style?: React.CSSProperties;
  /** CURRENT Next.js prop. React Router's SPA links do not prefetch. */
  prefetch?: boolean;
};

export function OpsLink({ href, className, children, "aria-current": current,
  "aria-label": label, style }: OpsLinkProps): React.ReactElement {
  const props = { className, "aria-current": current, "aria-label": label, style, children };
  const local = /^\/(?:admin|manage)(?:\/|[?#]|$)/.test(href);
  return local ? <Link to={href} {...props} /> : <a href={href} {...props} />;
}
