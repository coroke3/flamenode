import * as React from "react";
import type { Metadata } from "next";
import { acceptLatestTerms } from "@/lib/actions/terms";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { firstSearchParamValue, sanitizeNextPath } from "#utils/next";
import { parseLegalMarkdown } from "@/lib/terms/legalMarkdown";
import {
  DEFAULT_TERMS_MARKDOWN,
  DEFAULT_TERMS_VERSION_LABEL,
} from "@/lib/terms/defaultTerms";
import { buildPageMetadata } from "@/lib/seo";
import { loadStaticRulesPage } from "@/lib/publicData/loader";
import { TermsAcceptSubmitButton } from "@/components/terms/TermsAcceptSubmitButton";

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
  searchParams?: Promise<{ next?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeNextPath(params?.next);
  const errorCode = firstSearchParamValue(params?.error);
  const staticRules = await loadStaticRulesPage();

  const body = staticRules.rules?.bodyMarkdown ?? DEFAULT_TERMS_MARKDOWN;
  const updatedAt = staticRules.rules?.publishedAt ?? staticRules.rules?.updatedAt ?? null;
  const versionLabel = staticRules.rules?.versionLabel ?? DEFAULT_TERMS_VERSION_LABEL;

  const errorMessage =
    errorCode === "concurrent_update" || errorCode === "database_unavailable"
      ? "保存を完了できませんでした。再読み込み後にもう一度お試しください。同意済みの可能性があります。"
      : errorCode === "terms_commit_failed"
        ? "同意処理で問題が発生しました。再読み込みして状態を確認してください。"
        : errorCode
          ? "利用規約への同意を完了できませんでした。"
          : null;

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
        {errorMessage ? (
          <div className="fn-entry-status fn-entry-status--warn" role="alert">
            <Icon name="alert" size={18} aria-hidden />
            <div>
              <h2 className="fn-jp fn-panel-title">同意処理の確認</h2>
              <p className="fn-jp fn-entry-status-lead">{errorMessage}</p>
            </div>
          </div>
        ) : null}
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
            <TermsAcceptSubmitButton />
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
