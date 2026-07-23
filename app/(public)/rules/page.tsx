import * as React from "react";
import type { Metadata } from "next";
import { acceptLatestTerms } from "@/lib/actions/terms";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { sanitizeNextPath } from "#utils/next";
import { parseLegalMarkdown } from "@/lib/terms/legalMarkdown";
import {
  DEFAULT_TERMS_MARKDOWN,
  DEFAULT_TERMS_VERSION_LABEL,
} from "@/lib/terms/defaultTerms";
import { buildPageMetadata } from "@/lib/seo";
import { loadStaticRulesPage } from "@/lib/publicData/loader";

export const metadata: Metadata = buildPageMetadata({
  path: "/rules",
  title: "利用規約",
});

function renderMarkdown(markdown: string): React.ReactNode[] {
  return parseLegalMarkdown(markdown).map((block, blockIndex) => {
    const key = `${block.type}-${blockIndex}`;
    if (block.type === "heading2") return <h2 key={key}>{block.text}</h2>;
    if (block.type === "heading3") return <h3 key={key}>{block.text}</h3>;
    if (block.type === "list") {
      return (
        <ul key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{item}</li>
          ))}
        </ul>
      );
    }
    return <p key={key}>{block.text}</p>;
  });
}

export default async function RulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeNextPath(params?.next);
  const staticRules = await loadStaticRulesPage();

  const body = staticRules.rules?.bodyMarkdown ?? DEFAULT_TERMS_MARKDOWN;
  const updatedAt = staticRules.rules?.publishedAt ?? staticRules.rules?.updatedAt ?? null;
  const versionLabel = staticRules.rules?.versionLabel ?? DEFAULT_TERMS_VERSION_LABEL;

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <div className="fn-page-head-main">
          <span className="fn-eyebrow">RULES</span>
          <h1 className="fn-page-title fn-page-title--compact">利用規約</h1>
        </div>
        <p className="fn-page-lead">
          バージョン: {versionLabel}
          {updatedAt ? ` (更新: ${formatUnix(updatedAt, { dateOnly: true })})` : ""}
        </p>
      </header>
      <div className="fn-page-stack">
        <article className="fn-surface-panel fn-legal-body">
          {renderMarkdown(body)}
        </article>
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
    </div>
  );
}
