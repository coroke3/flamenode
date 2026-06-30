import * as React from "react";
import Link from "next/link";

type EventDirectoryNavProps = {
  active: "events" | "groups";
};

/** イベント一覧 ↔ グループ一覧の切り替え。 */
export function EventDirectoryNav({
  active,
}: EventDirectoryNavProps): React.ReactElement {
  return (
    <nav className="fn-event-dir-nav" aria-label="イベントの探し方">
      <div className="fn-cr-segment">
        <Link
          href="/event"
          className={`fn-cr-seg-btn ${active === "events" ? "is-active" : ""}`}
          aria-current={active === "events" ? "page" : undefined}
        >
          イベント一覧
        </Link>
        <Link
          href="/groups"
          className={`fn-cr-seg-btn ${active === "groups" ? "is-active" : ""}`}
          aria-current={active === "groups" ? "page" : undefined}
        >
          グループ一覧
        </Link>
      </div>
    </nav>
  );
}
