import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * 管理画面 / 公開ページ共用のページング UI。
 *
 * - 現在ページ・総ページ数・総件数を 1 行で表示する。
 * - `buildHref(page)` で各ページのリンクを組み立てる。URL のクエリパラメータを
 *   呼び出し側で構築するパターン (例: /admin/videos?q=foo&page=2)。
 * - `currentPage`, `totalPages`, `total` は呼び出し側で算出した値を渡す。
 *
 * 表示する数字リンクは「現在ページの前後 2 ページ + 端」(コンパクト省略 ...) 方式。
 * モバイルでも崩れにくいよう、白枠ボタン + 折返し可能なフレックスで組む。
 */
export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  total: number;
  buildHref: (page: number) => string;
  /** "件" のような単位ラベル。デフォルト "件"。 */
  unitLabel?: string;
  /** ページサイズ。総件数・現ページの「N / M」算出に使う。指定しない場合は表示を省略。 */
  pageSize?: number;
}

function pageNumbers(current: number, total: number): (number | "…")[] {
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
}: PaginationProps): React.ReactElement | null {
  if (totalPages <= 1) return null;
  const pages = pageNumbers(currentPage, totalPages);
  const rangeStart = pageSize ? (currentPage - 1) * pageSize + 1 : null;
  const rangeEnd = pageSize ? Math.min(currentPage * pageSize, total) : null;

  return (
    <nav
      aria-label="ページ送り"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        marginTop: 12,
        fontSize: 12,
        color: "var(--text-muted)",
      }}
    >
      <span style={{ marginRight: 8 }}>
        {rangeStart != null && rangeEnd != null && total > 0
          ? `${rangeStart}〜${rangeEnd} / 全 ${total} ${unitLabel}`
          : `全 ${total} ${unitLabel}`}
        {totalPages > 1 ? ` (${currentPage} / ${totalPages} ページ)` : null}
      </span>

      {currentPage > 1 ? (
        <Link
          href={buildHref(currentPage - 1)}
          className="fn-btn fn-btn-ghost fn-btn-sm"
          aria-label="前のページ"
          prefetch={false}
        >
          <Icon name="chevron-left" size={12} aria-hidden />
          前へ
        </Link>
      ) : (
        <span
          className="fn-btn fn-btn-ghost fn-btn-sm"
          aria-disabled
          style={{ opacity: 0.4, pointerEvents: "none" }}
        >
          <Icon name="chevron-left" size={12} aria-hidden /> 前へ
        </span>
      )}

      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} style={{ padding: "0 4px" }}>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={buildHref(p)}
            className={`fn-btn fn-btn-sm ${
              p === currentPage ? "fn-btn-primary" : "fn-btn-ghost"
            }`}
            aria-current={p === currentPage ? "page" : undefined}
            style={{ minWidth: 30, justifyContent: "center" }}
            prefetch={false}
          >
            {p}
          </Link>
        ),
      )}

      {currentPage < totalPages ? (
        <Link
          href={buildHref(currentPage + 1)}
          className="fn-btn fn-btn-ghost fn-btn-sm"
          aria-label="次のページ"
          prefetch={false}
        >
          次へ
          <Icon name="chevron-right" size={12} aria-hidden />
        </Link>
      ) : (
        <span
          className="fn-btn fn-btn-ghost fn-btn-sm"
          aria-disabled
          style={{ opacity: 0.4, pointerEvents: "none" }}
        >
          次へ <Icon name="chevron-right" size={12} aria-hidden />
        </span>
      )}
    </nav>
  );
}
