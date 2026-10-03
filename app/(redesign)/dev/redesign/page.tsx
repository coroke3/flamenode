import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  MOCK_CATEGORIES,
  MOCK_ROUTES,
  mockHref,
} from "./_catalog";
import { RedesignThemeToggle } from "./_theme-toggle";
import styles from "./redesign.module.css";

export const metadata: Metadata = {
  title: "UI Redesign Mock Gallery",
  robots: { index: false, follow: false },
};

export default function RedesignGalleryPage(): React.ReactElement {
  return (
    <div className={styles.redesignRoot}>
      <header className={styles.galleryHeader}>
        <div>
          <Link href="/" className={styles.brand}>FlameNode</Link>
          <span className={styles.headerLabel}>UI REDESIGN / MOCK ONLY</span>
        </div>
        <RedesignThemeToggle />
      </header>

      <main className={styles.galleryMain}>
        <section className={styles.galleryIntro}>
          <p className={styles.eyebrow}>NEXT UI STUDY</p>
          <h1>Mock Gallery</h1>
          <p>
            本番ページ・DB・外部APIから切り離した fixture-only の次期UI検討環境です。
            既存機能を消さず、要素・導線・視線移動を減らすことを優先しています。
          </p>
          <dl className={styles.coverageSummary}>
            <div><dt>Coverage</dt><dd>{MOCK_ROUTES.length} / {MOCK_ROUTES.length} pages</dd></div>
            <div><dt>Breakpoints</dt><dd>1440 / 1024 / 768 / 390</dd></div>
            <div><dt>Data</dt><dd>Fixture only</dd></div>
            <div><dt>Theme</dt><dd>Light / Dark</dd></div>
          </dl>
        </section>

        <nav className={styles.categoryNav} aria-label="モック分類">
          {MOCK_CATEGORIES.map((category) => (
            <a key={category} href={`#${category.toLowerCase()}`}>{category}</a>
          ))}
        </nav>

        {MOCK_CATEGORIES.map((category) => {
          const routes = MOCK_ROUTES.filter((item) => item.category === category);
          return (
            <section
              key={category}
              id={category.toLowerCase()}
              className={styles.gallerySection}
            >
              <div className={styles.sectionHeading}>
                <h2>{category}</h2>
                <span>{routes.length} screens</span>
              </div>
              <div className={styles.galleryTable} role="table" aria-label={`${category} mocks`}>
                <div className={`${styles.galleryRow} ${styles.galleryTableHead}`} role="row">
                  <span role="columnheader">Page</span>
                  <span role="columnheader">Purpose</span>
                  <span role="columnheader">Primary action</span>
                  <span role="columnheader">Source</span>
                </div>
                {routes.map((item) => (
                  <Link
                    key={item.id}
                    href={mockHref(item)}
                    className={styles.galleryRow}
                    role="row"
                  >
                    <span role="cell" className={styles.galleryPageCell}>
                      <strong>{item.title}</strong>
                      <code>{item.url}</code>
                    </span>
                    <span role="cell">{item.purpose}</span>
                    <span role="cell">{item.primaryAction}</span>
                    <span role="cell" className={styles.sourceCell}>{item.source}</span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
