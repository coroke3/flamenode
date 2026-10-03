import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MOCK_ROUTES, MOCK_ROUTE_BY_ID } from "../../_catalog";
import { RedesignThemeToggle } from "../../_theme-toggle";
import { MockScreen } from "../../_mock-screen";
import styles from "../../redesign.module.css";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ id: string }> {
  return MOCK_ROUTES.map((item) => ({ id: item.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = MOCK_ROUTE_BY_ID.get(id);
  return {
    title: item ? `${item.title} — Redesign Mock` : "Redesign Mock",
    robots: { index: false, follow: false },
  };
}

function PublicHomeStates(): React.ReactElement {
  return (
    <section className={styles.stateLab} aria-label="公開トップの重要状態">
      <div className={styles.stateLabHead}>
        <div><p className={styles.eyebrow}>STATE LAB</p><h2>公開トップの重要状態</h2></div>
        <span>実画面外のレビュー用</span>
      </div>
      <div className={styles.stateGrid}>
        <article><strong>Reflection pending</strong><p>更新反映中であることだけを短く表示し、古い作品一覧と混在させない。</p></article>
        <article><strong>Data unavailable</strong><p>取得不能を明示し、再試行または後で確認する導線だけを出す。</p><button className={styles.secondaryButton}>再試行</button></article>
        <article><strong>Degraded</strong><p>利用可能な作品データは表示し、利用不能な棚だけを消す。ページ全体をエラー化しない。</p></article>
      </div>
    </section>
  );
}

export default async function RedesignMockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const item = MOCK_ROUTE_BY_ID.get(id);
  if (!item) notFound();

  return (
    <div className={styles.redesignRoot}>
      <div className={styles.mockToolbar}>
        <div className={styles.mockToolbarInfo}>
          <Link href="/dev/redesign" className={styles.backLink}>Mock Gallery</Link>
          <span>{item.category}</span>
          <code>{item.url}</code>
          <span className={styles.toolbarSource}>{item.source}</span>
        </div>
        <RedesignThemeToggle />
      </div>
      <MockScreen item={item} />
      {item.kind === "public-home" ? <PublicHomeStates /> : null}
    </div>
  );
}
