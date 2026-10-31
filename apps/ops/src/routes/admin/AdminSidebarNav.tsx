import * as React from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "../../components/shared/Icon.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { buildAdminNavGroups } from "./AdminNavGroups.js";

export type AdminSidebarGroup = {
  title: string;
  items: Array<{ href: string; label: string; icon: React.ReactNode }>;
};

/** CURRENT AdminSidebarNav semantics: query-specialized entries take priority over plain paths. */
export function isAdminNavActive(
  href: string, pathname: string, search: string, groups: readonly AdminSidebarGroup[],
): boolean {
  const [hrefPath, hrefQuery] = href.split("?");
  const params = new URLSearchParams(search);
  if (hrefQuery) {
    if (pathname !== hrefPath) return false;
    for (const [key, value] of new URLSearchParams(hrefQuery)) {
      if (params.get(key) !== value) return false;
    }
    return true;
  }
  const specialized = groups.some((group) => group.items.some((item) => {
    const [path, query] = item.href.split("?");
    if (!query || path !== hrefPath || pathname !== path) return false;
    for (const [key, value] of new URLSearchParams(query)) {
      if (params.get(key) !== value) return false;
    }
    return true;
  }));
  if (specialized) return false;
  if (hrefPath === "/admin") return pathname === "/admin";
  return pathname === hrefPath || pathname.startsWith(hrefPath + "/");
}

export function AdminSidebarNav({ enableSpreadsheet = false }: {
  enableSpreadsheet?: boolean;
}): React.ReactElement {
  const { pathname, search } = useLocation();
  const groups = React.useMemo(() => buildAdminNavGroups(enableSpreadsheet), [enableSpreadsheet]);
  return (
    <nav className="admin-nav" aria-label="管理ナビゲーション">
      {groups.map((group) => (
        <section key={group.title} className="admin-nav-group">
          <h2 className="admin-nav-group-title">{group.title}</h2>
          {group.items.map((item) => {
            const active = isAdminNavActive(item.href, pathname, search, groups);
            return (
              <OpsLink
                key={item.href}
                href={item.href}
                className={"admin-nav-link" + (active ? " admin-nav-link-active" : "")}
                aria-current={active ? "page" : undefined}
              >
                {item.icon}{item.label}
              </OpsLink>
            );
          })}
        </section>
      ))}
    </nav>
  );
}

/** Exactly CURRENT's Admin branch; the OpsGate must authorize before this renders. */
export function AdminSidebar({ enableSpreadsheet = false }: {
  enableSpreadsheet?: boolean;
}): React.ReactElement {
  return (
    <aside className="admin-sidebar">
      <div className="admin-mode-banner">
        <span className="admin-mode-badge">ADMIN</span>
        <span className="admin-mode-label">サイト管理</span>
        <p className="admin-mode-hint">
          サイト全体の設定・監査・ユーザー管理を行います。
          担当イベントの現場運用は<strong> /manage</strong>から行ってください。
        </p>
      </div>
      <AdminSidebarNav enableSpreadsheet={enableSpreadsheet} />
    </aside>
  );
}
