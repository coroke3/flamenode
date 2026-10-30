import * as React from "react";

/**
 * MIG-0737 U01: CURRENT admin spreadsheet feature-disabled explanation.
 * This is an unmounted presentation component; authorization and the
 * ADMIN_SPREADSHEET_ENABLED check must be enforced by the server.
 */
export function AdminSpreadsheetDisabled(): React.ReactElement {
  return (
    <section aria-labelledby="admin-spreadsheet-disabled-title" style={{ paddingBottom: 48 }}>
      <header>
        <a href="/admin">ダッシュボードへ戻る</a>
        <h1 id="admin-spreadsheet-disabled-title">DB スプレッドシート</h1>
        <p>この機能は環境変数で有効化する必要があります。</p>
      </header>
      <div className="fn-card" style={{ padding: 20, maxWidth: 560, lineHeight: 1.65 }}>
        <p style={{ margin: "0 0 12px" }}>
          <code>ADMIN_SPREADSHEET_ENABLED=true</code> が未設定のため、スプレッドシートは無効です。
        </p>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>リポジトリ直下の <code>.dev.vars</code> に <code>ADMIN_SPREADSHEET_ENABLED="true"</code> を追加</li>
          <li><code>npm run dev</code> を再起動（ポートはターミナル表示を確認）</li>
        </ol>
      </div>
    </section>
  );
}
