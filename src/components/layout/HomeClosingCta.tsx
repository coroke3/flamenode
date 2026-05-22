import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import styles from "./HomeClosingCta.module.css";

export function HomeClosingCta(): React.ReactElement {
  return (
    <section className={styles.closingCta} aria-label="FlameNode のイベント">
      <div>
        <p>次の出会いは、</p>
        <h2>作品のすぐ隣にある。</h2>
      </div>
      <div className={styles.closingActions}>
        <Link href="/event" className="fn-btn fn-btn-primary">
          すべてのイベントを見る
          <Icon name="chevron-right" size={14} aria-hidden />
        </Link>
        <Link href="/about" className="fn-btn fn-btn-ghost">
          FlameNodeについて
        </Link>
      </div>
    </section>
  );
}
