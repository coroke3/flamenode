import * as React from "react";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";
import { LegacyImportClient } from "@/components/admin/LegacyImportClient";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminVideoManagementTabs } from "@/components/admin/AdminVideoManagementTabs";
import { isLegacyImportToolEnabled } from "@/lib/import/legacy/featureFlag";

export const metadata: Metadata = { title: "旧データ移行ツール" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ notice?: string }>;
}

export default async function AdminImportPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { notice = "" } = await searchParams;
  const enabled = isLegacyImportToolEnabled();

  return (
    <div>
      <AdminPageHeader
        title="旧データ移行ツール"
        description="旧 EventArchives の eventinfo.json / video.json / ヘッダー付き CSV から、イベント・運営メンバー・作品・合作メンバー・X ID を取り込みます。"
      />
      <AdminVideoManagementTabs />

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

      {!enabled ? (
        <div
          style={{
            marginTop: 22,
            padding: "16px 18px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-elevated)",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          <Icon name="warning" size={14} aria-hidden />{" "}
          旧データ移行ツールは現在無効です。有効にするには環境変数{" "}
          <code>ENABLE_LEGACY_IMPORT_TOOL=true</code> を設定してください。
        </div>
      ) : null}

      {enabled ? (
        <>
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
              <li>
                衝突時の方針を <strong>skip_existing</strong>（既存を保護）または{" "}
                <strong>replace_imported</strong>（過去取り込み分を置き換え）から選んで取り込みます。
              </li>
              <li>取り込み結果はバッチ記録・監査ログに残ります。</li>
            </ol>
            <p className="fn-help">
              旧データ由来の X ID は <code>approval_status=imported</code>{" "}
              として取り込みます。Discord 連携による本人確認は別途 X ID 申請で行います。
            </p>
          </section>

          <section className="fn-card" style={{ marginTop: 22 }}>
            <LegacyImportClient />
          </section>
        </>
      ) : null}
    </div>
  );
}
