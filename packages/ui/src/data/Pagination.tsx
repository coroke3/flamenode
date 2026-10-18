import React from "react";
import { Link } from "../adapters/index.js";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  total?: number;
  buildHref: (page: number) => string;
  unitLabel?: string;
  pageSize?: number;
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function pageNumbers(current: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  const spread = 2;
  const start = Math.max(1, current - spread);
  const end = Math.min(total, current + spread);

  if (start > 1) {
    out.push(1);
    if (start > 2) out.push("…");
  }
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total) {
    if (end < total - 1) out.push("…");
    out.push(total);
  }
  return out;
}

export function Pagination({
  currentPage,
  totalPages,
  total,
  buildHref,
  unitLabel = "件",
  pageSize,
  className,
}: PaginationProps): React.ReactElement | null {
  if (totalPages <= 1) return null;

  const pages = pageNumbers(currentPage, totalPages);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <nav
      aria-label="ページ送り"
      className={cx("fn-pagination", className)}
    >
      <div className="fn-pagination-controls">
        {hasPrev ? (
          <Link
            href={buildHref(currentPage - 1)}
            className="fn-btn fn-btn--secondary fn-btn--sm fn-pagination-prev"
            aria-label="前のページ"
          >
            前へ
          </Link>
        ) : (
          <span
            className="fn-btn fn-btn--secondary fn-btn--sm fn-pagination-prev is-disabled"
            aria-disabled="true"
          >
            前へ
          </span>
        )}

        <div className="fn-pagination-pages">
          {pages.map((p, idx) => {
            if (p === "…") {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  className="fn-pagination-ellipsis"
                  aria-hidden="true"
                >
                  …
                </span>
              );
            }
            const isCurrent = p === currentPage;
            return isCurrent ? (
              <span
                key={p}
                className="fn-pagination-page is-current"
                aria-current="page"
              >
                {p}
              </span>
            ) : (
              <Link
                key={p}
                href={buildHref(p)}
                className="fn-pagination-page"
                aria-label={`${p}ページ目へ`}
              >
                {p}
              </Link>
            );
          })}
        </div>

        {hasNext ? (
          <Link
            href={buildHref(currentPage + 1)}
            className="fn-btn fn-btn--secondary fn-btn--sm fn-pagination-next"
            aria-label="次のページ"
          >
            次へ
          </Link>
        ) : (
          <span
            className="fn-btn fn-btn--secondary fn-btn--sm fn-pagination-next is-disabled"
            aria-disabled="true"
          >
            次へ
          </span>
        )}
      </div>

      {/* CURRENT text: "21〜40 / 全 95 件 (2 / 5 ページ)" */}
      {total !== undefined ? (
        <span className="fn-pagination-total">
          {pageSize && total > 0
            ? `${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, total)} / 全 ${total} ${unitLabel}`
            : `全 ${total} ${unitLabel}`}
          {` (${currentPage} / ${totalPages} ページ)`}
        </span>
      ) : null}
    </nav>
  );
}
