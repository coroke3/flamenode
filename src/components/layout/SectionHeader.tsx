import * as React from "react";
import Link from "next/link";

export interface SectionHeaderClasses {
  root?: string;
  left?: string;
  titles?: string;
  eyebrow?: string;
  titleLine?: string;
  title?: string;
  description?: string;
  action?: string;
}

interface SectionHeaderProps {
  title: string;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  moreHref?: string;
  moreLabel?: string;
  classes?: SectionHeaderClasses;
}

export function SectionHeader({
  title,
  eyebrow,
  description,
  action,
  moreHref,
  moreLabel = "もっと見る",
  classes = {},
}: SectionHeaderProps): React.ReactElement {
  const titleContent = (
    <>
      <h2 className={classes.title ?? "fn-display fn-section-title"}>{title}</h2>
      {description ? (
        <span className={classes.description ?? "fn-section-jp fn-jp"}>
          {description}
        </span>
      ) : null}
    </>
  );
  const actionNode = action ?? (
    moreHref ? (
      <Link href={moreHref} className={classes.action ?? "fn-section-more"}>
        {moreLabel}
        <span aria-hidden>→</span>
      </Link>
    ) : null
  );

  return (
    <header className={classes.root ?? "fn-section-head"}>
      <div className={classes.left ?? "fn-section-head-left"}>
        <div className={classes.titles ?? "fn-section-titles"}>
          {eyebrow ? (
            <p className={classes.eyebrow ?? "fn-eyebrow"}>{eyebrow}</p>
          ) : null}
          {classes.titleLine ? (
            <div className={classes.titleLine}>{titleContent}</div>
          ) : (
            titleContent
          )}
        </div>
      </div>
      {actionNode}
    </header>
  );
}
