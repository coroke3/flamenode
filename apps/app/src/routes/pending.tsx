import * as React from "react";

/**
 * Placeholder body for a screen whose Hono read endpoint does not exist yet
 * (MIG-0701 blocker B1). It is NOT a CURRENT state; it is removed per screen
 * when the endpoint lands. Gated by the session guard, so it never shows to
 * anonymous/banned users.
 */
export function PendingData({ title, endpoint }: { title: string; endpoint: string }): React.ReactElement {
  return (
    <div className="fn-public-container fn-page" data-mig-pending={endpoint}>
      <header className="fn-page-head">
        <h1 className="fn-display fn-page-title">{title}</h1>
      </header>
      <div className="fn-empty" role="status">
        <p className="fn-empty-message">この画面のデータ取得APIは移行中です。（{endpoint}）</p>
      </div>
    </div>
  );
}
