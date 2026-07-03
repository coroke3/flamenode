import * as React from "react";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { termsVersions } from "@/lib/db/schema";
import { acceptLatestTerms } from "@/lib/actions/terms";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { sanitizeUserHtml } from "@/lib/utils/sanitizeUserHtml";
import { sanitizeNextPath } from "#utils/next";
import {
  DEFAULT_TERMS_MARKDOWN,
  DEFAULT_TERMS_VERSION_LABEL,
} from "@/lib/terms/defaultTerms";

export const metadata: Metadata = { title: "利用規約" };
export const dynamic = "force-dynamic";

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
      .orderBy(desc(termsVersions.published_at), desc(termsVersions.updated_at))
      .limit(1);
    if (rows[0]) {
      return {
        body: rows[0].body_markdown,
        updatedAt: rows[0].published_at ?? rows[0].updated_at,
        versionLabel: rows[0].version_label,
      };
    }
    return null;
  }).catch((error) => {
    console.error("[RulesPage] failed to load published terms", error);
    return null;
  });

  const body = data?.body ?? DEFAULT_TERMS_MARKDOWN;
  const updatedAt = data?.updatedAt ?? null;
  const versionLabel = data?.versionLabel ?? DEFAULT_TERMS_VERSION_LABEL;

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
