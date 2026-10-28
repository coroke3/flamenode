import * as React from "react";

/**
 * MIG-0707 U05b: static projection of CURRENT app/not-found.tsx.
 * The fixed EmptyState props are rendered directly until the U05 shared
 * EmptyState/Icon port lands; class names target that port's generated CSS.
 * No guard, account data, or client fetch is involved.
 */
export function NotFoundView(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page" style={{ paddingBlock: "48px 64px" }}>
      <section className="fn-empty-state empty-empty empty-tone-neutral">
        <div className="empty-icon" aria-hidden="true">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <h2 className="empty-title">ページが見つかりません</h2>
        <p className="empty-description">URL を確認するか、トップページから再度お探しください。</p>
        <div className="empty-actions">
          <a href="/" className="fn-btn fn-btn-primary">トップへ戻る</a>
        </div>
      </section>
    </div>
  );
}
