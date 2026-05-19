import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import styles from "./AdminPageHeader.module.css";

export interface AdminPageHeaderAction {
  href: string;
  label: string;
  icon?: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
}

export interface AdminPageHeaderProps {
  title: string;
  description?: string;
  /** 戻る先のパス (一覧 or 詳細)。指定するとタイトル左に戻るリンクを表示。 */
  backHref?: string;
  /** 戻るリンクのラベル。省略時は「戻る」。 */
  backLabel?: string;
  /** 右側に並べる主要アクション。横断遷移は admin サイドバーに任せる。 */
  actions?: AdminPageHeaderAction[];
}

function variantClass(variant: AdminPageHeaderAction["variant"]): string {
  switch (variant) {
    case "primary":
      return "fn-btn fn-btn-primary fn-btn-sm";
    case "danger":
      return "fn-btn fn-btn-danger fn-btn-sm";
    case "ghost":
    default:
      return "fn-btn fn-btn-ghost fn-btn-sm";
  }
}

/**
 * admin 配下ページの共通上部ヘッダー。
 *
 * 役割:
 *   - ページタイトル / 説明文を統一表示
 *   - 戻るリンク (`backHref`) を左に置く (詳細/編集ページ向け)
 *   - 主要アクション (`actions`) を右に置く (新規作成・編集ボタン等)
 *
 * 横断遷移 (他カテゴリへの移動) は admin サイドバーに任せ、本コンポーネントには置かない。
 * これによりページ遷移ごとに上部ボタン構成がバラバラになる UX 不整合を解消する。
 */
export function AdminPageHeader({
  title,
  description,
  backHref,
  backLabel = "戻る",
  actions = [],
}: AdminPageHeaderProps): React.ReactElement {
  return (
    <header className={styles.header}>
      <div className={styles.titleArea}>
        {backHref ? (
          <Link href={backHref} className={styles.backLink}>
            <Icon name="chevron-left" size={12} aria-hidden /> {backLabel}
          </Link>
        ) : null}
        <h1 className={styles.title}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions.length > 0 ? (
        <div className={styles.actions}>
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={variantClass(action.variant)}
            >
              {action.icon}
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </header>
  );
}
