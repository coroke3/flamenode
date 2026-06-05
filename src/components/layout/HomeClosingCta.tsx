import * as React from "react";
import Link from "next/link";
import styles from "./HomeClosingCta.module.css";

export function HomeClosingCta(): React.ReactElement {
  return (
    <section
      className="fn-public-container fn-closing"
      aria-label="FlameNode のイベント"
    >
      <div className="fn-closing-line">
        <span className="fn-display fn-closing-text">
          Upload your frame.
        </span>
        <span className="fn-jp fn-closing-jp">
          あなたのフレームをアーカイブに残す。
        </span>
      </div>
      <div className={styles.closingActions}>
        <Link href="/dashboard/post" className="fn-btn fn-btn-primary fn-btn-lg">
          新規投稿を始める →
        </Link>
        <Link href="/about" className="fn-btn fn-btn-ghost">
          FlameNodeについて
        </Link>
      </div>
    </section>
  );
}
