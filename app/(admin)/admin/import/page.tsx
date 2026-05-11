import * as React from "react";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";
import { LegacyImportClient } from "@/components/admin/LegacyImportClient";

export const metadata: Metadata = { title: "レガシーインポート" };

interface Props {
  searchParams: Promise<{ notice?: string }>;
}

export default async function AdminImportPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { notice = "" } = await searchParams;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>レガシーデータ・インポート</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        旧 EventArchives の JSON エクスポート（<code>eventinfo.json</code> / <code>video.json</code>）
        から、イベント本体・運営メンバー・作品・合作メンバー・X ID プレースホルダーを取り込みます。
      </p>

      {notice ? (
        <div
          role="status"
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-default)",
            background: "var(--bg-elevated)",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          <Icon name="info" size={14} aria-hidden /> {notice}
        </div>
      ) : null}

      <section
        style={{
          marginTop: 22,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: 22,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>手順</h2>
        <ol
          style={{
            paddingLeft: 18,
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.8,
          }}
        >
          <li>
            <strong>アップロード</strong>: <code>eventinfo.json</code> と <code>video.json</code>
            を投入。複数同時可。両方ある場合はイベントを先に取り込みます。
          </li>
          <li>
            <strong>ドライラン</strong>: 既存 ID との衝突件数、警告、文字化け疑い、X ID プレースホルダー候補を確認。
          </li>
          <li>
            <strong>衝突戦略</strong>: イベント / 動画それぞれに{" "}
            <code>skip</code>（既存保護）/ <code>update</code>（全置換）/ <code>merge</code>
            （空き埋め）を指定。
          </li>
          <li>
            <strong>取り込み</strong>: 行ごとに try/catch でロールバックし、結果は{" "}
            <code>history_logs</code> に <code>retention_class=&apos;long_audit&apos;</code> で記録。
          </li>
        </ol>
        <p
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.7,
          }}
        >
          ※ 旧データの X ID は未承認プレースホルダー (<code>x_users.approval_status = &apos;pending&apos;</code>) で登録します。
          本人による Discord 連携後に <code>x_account_link_requests</code> から承認してください。
          外部画像 URL (Gyazo / pbs.twimg.com など) は R2 に再保存せず参照のまま保持し、Google Drive URL のみ直リンクに正規化します。
        </p>
      </section>

      <section
        style={{
          marginTop: 22,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: 22,
        }}
      >
        <LegacyImportClient />
      </section>

      <details
        style={{
          marginTop: 22,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: 16,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
          }}
        >
          互換フォーム（単一ファイル / form-urlencoded 用フォールバック）
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
          <label className="fn-label">JSON ファイル</label>
          <input
            type="file"
            name="file"
            accept="application/json"
            className="fn-input"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              name="dry_run"
              value="1"
              className="fn-btn fn-btn-ghost"
            >
              <Icon name="info" size={12} aria-hidden /> ドライラン
            </button>
            <button type="submit" className="fn-btn fn-btn-primary">
              <Icon name="upload" size={12} aria-hidden /> 取り込み (skip 既定)
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
