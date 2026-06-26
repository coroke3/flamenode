import * as React from "react";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";
import { LegacyImportClient } from "@/components/admin/LegacyImportClient";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminVideoManagementTabs } from "@/components/admin/AdminVideoManagementTabs";

export const metadata: Metadata = { title: "レガシーインポート" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ notice?: string }>;
}

export default async function AdminImportPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { notice = "" } = await searchParams;

  return (
    <div>
      <AdminPageHeader
        title="レガシーデータ・インポート"
        description="旧 EventArchives の eventinfo.json / video.json / ヘッダー付き CSV から、イベント・運営メンバー・作品・合作メンバー・X ID を取り込みます。"
      />
      <AdminVideoManagementTabs active="import" />
      {notice ? (
        <div
          role="status"
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-elevated)",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          <Icon name="info" size={14} aria-hidden /> {notice}
        </div>
      ) : null}

      <section className="fn-card" style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>手順</h2>
        <ol
          style={{
            paddingLeft: 18,
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.8,
          }}
        >
          <li>JSON または CSV を投入します。複数ファイルを同時に扱えます。</li>
          <li>まずドライランで件数・衝突・文字化け疑いを確認します。</li>
          <li>衝突時の方針を skip / update / merge から選んで取り込みます。</li>
          <li>取り込み結果は監査ログに残ります。</li>
        </ol>
        <p className="fn-help">
          旧データ由来の X ID は公開プロフィールとして扱い、Discord 連携の本人確認は別途 X ID 申請で行います。
        </p>
      </section>

      <section className="fn-card" style={{ marginTop: 22 }}>
        <LegacyImportClient />
      </section>

      <details className="fn-card" style={{ marginTop: 22 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
          }}
        >
          シンプルフォーム
        </summary>
        <form
          action="/api/admin/legacy-import"
          method="post"
          encType="multipart/form-data"
          style={{
            marginTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <label className="fn-label">JSON / CSV ファイル</label>
          <input
            type="file"
            name="file"
            accept="application/json,text/csv,.json,.csv"
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
      </details>
    </div>
  );
}
