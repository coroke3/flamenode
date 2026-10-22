import React from "react";
import { Link } from "../adapters/index.js";
import { ScreenIcon } from "./parts.js";

/*
 * Maintenance (`/maintenance`, MIG-0619). Layout follows the registered mock
 * `docs/migration/mock/static/Maintenance.html` (warning status, `t-display` heading, `.wrap`);
 * the texts and the "back to top" action are CURRENT `app/(public)/maintenance/page.tsx`
 * (the mock's reload button needs JavaScript and is not part of CURRENT). Static, no props.
 */
export function MaintenanceView(): React.ReactElement {
  return (
    <div className="p-root" data-theme="dark" lang="ja" style={{ display: "flex", flexDirection: "column" }}>
      <main
        className="wrap"
        style={{ width: "100%", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24, paddingBottom: 120 }}
      >
        <span className="fn-status fn-status--warning">
          <ScreenIcon name="warning" />
          <span>メンテナンス中</span>
        </span>
        <h1 className="t-display">メンテナンス中</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
          FlameNode は現在メンテナンスを実施しています。
          <br />
          ご迷惑をおかけしますが、しばらくお待ちください。
        </p>
        <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
          Cloudflare コストガード機能により、書き込み操作が一時的に停止される場合があります。
          閲覧のみは静的 JSON で継続提供します。
        </p>
        <div className="actions">
          <Link href="/" className="fn-btn fn-btn--primary">
            トップへ戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
