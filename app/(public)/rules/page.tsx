import * as React from "react";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { termsVersions } from "@/lib/db/schema";
import { acceptLatestTerms } from "@/lib/actions/terms";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { sanitizeUserHtml } from "@/lib/utils/sanitizeUserHtml";
import { sanitizeNextPath } from "#utils/next";

export const metadata: Metadata = { title: "利用規約" };
export const dynamic = "force-dynamic";

const FALLBACK = `# FlameNode 利用規約 (暫定)

FlameNode は YouTube 埋め込みを利用した動画プラットフォームです。
本サイトを利用される前に、以下の項目に同意の上、ご利用ください。

## 1. アカウント

* Discord 認証を介したアカウントを利用します。
* X (Twitter) アカウントは X ID として連携でき、作者・参加者の主体として表示されます。

## 2. 投稿

* YouTube に公開された動画のみを取り扱います。動画ファイル本体は本サービスにアップロードされません。
* 著作権・肖像権など第三者の権利を侵害する動画の登録は禁止します。

## 3. イベント

* 第三者主催のイベントは、運営の承認のもと開催できます。
* イベント運営は、参加者の作品情報を必要な範囲で閲覧・編集できます。

## 4. 禁止事項

* 他者への迷惑行為、プラットフォームの安定運用を妨げる行為。
* 不正な情報の登録、なりすまし、悪意あるリンク投稿。

## 5. 免責

* 本サービスは無料で提供されます。可用性・継続性を保証するものではありません。
* 公開状態の管理は投稿者の責任で行ってください。

## 6. 変更

* 本規約は予告なく変更される場合があります。重要な変更があった場合は、次回投稿時に再同意を求めます。

更新日: 2026-05-01`;

function renderMarkdown(md: string): string {
  // 軽量 Markdown ライク変換 (見出し・リスト・段落のみ)
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${escape(line.slice(2))}</h2>`);
    } else if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${escape(line.slice(3))}</h3>`);
    } else if (line.startsWith("* ") || line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${escape(line.slice(2))}</li>`);
    } else if (line === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("");
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${escape(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default async function RulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeNextPath(params?.next);
  const data = await withDatabase(async (db) => {
    const rows = await db
      .select()
      .from(termsVersions)
      .where(eq(termsVersions.status, "published"))
      .limit(1);
    if (rows[0]) {
      return {
        body: rows[0].body_markdown,
        updatedAt: rows[0].published_at ?? rows[0].updated_at,
        versionLabel: rows[0].version_label,
      };
    }
    return null;
  });

  const body = data?.body ?? FALLBACK;
  const updatedAt = data?.updatedAt ?? null;
  const versionLabel = data?.versionLabel ?? "draft-2026-05";

  return (
    <main className="fn-public-container fn-page">
      <header className="fn-page-head">
        <h1 className="fn-page-title fn-page-title--compact">利用規約</h1>
        <p className="fn-page-lead">
          バージョン: {versionLabel}
          {updatedAt ? ` (更新: ${formatUnix(updatedAt, { dateOnly: true })})` : ""}
        </p>
      </header>
      <div className="fn-page-stack">
        <article
          className="fn-surface-panel fn-legal-body"
          dangerouslySetInnerHTML={{ __html: sanitizeUserHtml(renderMarkdown(body)) }}
        />
        <section className="fn-surface-panel">
          <h2 className="fn-panel-title">利用規約への同意</h2>
          <p className="fn-panel-lead">
            枠確保、投稿、いいね、セーブなどの書き込み操作には利用規約への同意が必要です。
            {next !== "/dashboard" ? " 同意後、元のページへ戻ります。" : ""}
          </p>
          <form action={acceptLatestTerms} className="fn-panel-actions">
            <input type="hidden" name="next" value={next} />
            <button type="submit" className="fn-btn fn-btn-primary">
              利用規約に同意して戻る
            </button>
          </form>
        </section>
        <section id="event-host" className="fn-surface-panel">
          <h2 className="fn-panel-title fn-panel-title--icon">
            <Icon name="calendar" size={16} aria-hidden /> イベント開催相談
          </h2>
          <p className="fn-panel-lead">
            第三者主催イベントを開催したい場合は、Discord またはお問い合わせから運営にご連絡ください。
            管理者が承認した X ID にイベント編集許可者ロールを付与します。
          </p>
        </section>
      </div>
    </main>
  );
}
