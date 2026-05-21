import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * 「現在絞り込みに使っている条件」をチップで列挙し、× クリックで個別解除できる UI。
 *
 * - 各チップは Link で、自分の条件を除いた検索URL を生成して飛ぶ。
 * - 全件解除リンク (条件を全部外した URL) を末尾に置く。
 *
 * 呼び出し側は `chips` に `[{ label, removeHref }]` の配列、
 * `clearAllHref` にすべての条件を消した URL を渡す。
 * チップが 0 件なら何も描画しない。
 */
export interface FilterChip {
  /** 表示ラベル。例: `状態: 公開` */
  label: string;
  /** このチップだけ消した検索URL */
  removeHref: string;
}

export function FilterChips({
  chips,
  clearAllHref,
}: {
  chips: FilterChip[];
  clearAllHref: string;
}): React.ReactElement | null {
  if (chips.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        marginTop: 8,
      }}
      aria-label="現在の絞り込み条件"
    >
      <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 4 }}>
        絞り込み:
      </span>
      {chips.map((c, i) => (
        <Link
          key={`${c.label}-${i}`}
          href={c.removeHref}
          className="fn-btn fn-btn-sm"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
            fontWeight: 600,
            padding: "2px 8px",
            height: 22,
            fontSize: 11,
            borderRadius: 999,
            gap: 4,
          }}
          aria-label={`${c.label} を解除`}
          title={`${c.label} を解除`}
        >
          {c.label}
          <Icon name="close" size={10} aria-hidden />
        </Link>
      ))}
      {chips.length > 1 ? (
        <Link
          href={clearAllHref}
          className="fn-btn fn-btn-ghost fn-btn-sm"
          style={{ fontSize: 11, height: 22 }}
        >
          すべて解除
        </Link>
      ) : null}
    </div>
  );
}
