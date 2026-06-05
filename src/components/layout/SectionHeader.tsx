import * as React from "react";
import Link from "next/link";

interface SectionHeaderProps {
  title: string;
  description?: string;
  moreHref?: string;
  moreLabel?: string;
}

/**
 * 公開面セクション見出し（claudedesign / Standalone 準拠）
 */
export function SectionHeader({
  title,
  description,
  moreHref,
  moreLabel = "もっと見る",
}: SectionHeaderProps): React.ReactElement {
  return (
    <header className="fn-section-head">
      <div className="fn-section-head-left">
        <div className="fn-section-titles">
          <h2 className="fn-display fn-section-title">{title}</h2>
          {description ? (
            <span className="fn-section-jp fn-jp">{description}</span>
          ) : null}
        </div>
      </div>
      {moreHref ? (
        <Link href={moreHref} className="fn-section-more">
          {moreLabel}
          <span aria-hidden>→</span>
        </Link>
      ) : null}
    </header>
  );
}
