import * as React from "react";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "レガシーインポート" };

export default function AdminImportPage(): React.ReactElement {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>レガシーデータ・インポート</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        旧 EventArchives の JSON エクスポートから、ユーザー / イベント / 作品 / コメントを取り込みます。
      </p>

      <section
        style={{
          marginTop: 22,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: 22,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          手順
        </h2>
        <ol
          style={{
            paddingLeft: 18,
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.8,
          }}
        >
          <li>旧データの JSON 一式 (events / videos / users / comments) をアップロード</li>
          <li>差分プレビュー: 既存 ID と衝突するレコードを「skip / update / merge」で個別判定</li>
          <li>適用: 監査ログに記録され、失敗時はトランザクション単位でロールバック</li>
        </ol>
      </section>

      <form
        action="/api/admin/legacy-import"
        method="post"
        encType="multipart/form-data"
        style={{
          marginTop: 22,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <label className="fn-label">JSON ファイル</label>
        <input
          type="file"
          name="file"
          accept="application/json"
          className="fn-input"
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" name="dry_run" value="1" className="fn-btn fn-btn-ghost">
            <Icon name="info" size={12} aria-hidden /> ドライラン
          </button>
          <button type="submit" className="fn-btn fn-btn-primary">
            <Icon name="upload" size={12} aria-hidden /> 取り込み
          </button>
        </div>
      </form>
    </div>
  );
}
