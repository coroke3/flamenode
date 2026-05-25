import * as React from "react";

interface SectionHeaderProps {
  title: string;
  description?: string;
  moreHref?: string;
  moreLabel?: string;
}

export function SectionHeader({
  title,
  description,
  moreHref,
  moreLabel = "もっと見る",
}: SectionHeaderProps): React.ReactElement {
  return (
    <div className="fn-section-header">
      <div className="fn-section-header-center">
        <h2 className="fn-section-title">{title}</h2>
        {description ? (
          <p className="fn-section-description">{description}</p>
        ) : null}
      </div>
      {moreHref ? (
        <a href={moreHref} className="fn-section-more">
          {moreLabel} →
        </a>
      ) : null}
    </div>
  );
}
