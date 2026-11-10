import * as React from "react";
import { Link, useLocation } from "react-router-dom";

/** Shared video-admin navigation. MIG-0735 owns the first migration; MIG-0729 may reuse this component. */
export function AdminVideoManagementTabs(): React.ReactElement {
  const { pathname } = useLocation();
  return <nav aria-label="動画管理" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
    {[
      ["/admin/videos", "作品管理"],
      ["/admin/youtube-sync", "YouTube同期"],
      ["/admin/youtube-sync/playlists", "イベント再生リスト"],
      ["/admin/youtube-quota", "YouTube quota"],
    ].map(([href, label]) =>
      <Link key={href} to={href} aria-current={pathname === href ? "page" : undefined}
        className={pathname === href ? "fn-btn fn-btn-primary fn-btn-sm" : "fn-btn fn-btn-ghost fn-btn-sm"}>{label}</Link>)}
  </nav>;
}
