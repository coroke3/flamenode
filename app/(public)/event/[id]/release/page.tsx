import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  loadStaticEventRelease,
  PublicDataUnavailableNotice,
  PublicReflectionPendingNotice,
} from "@/lib/publicData/loader";
import { buildPageMetadata } from "@/lib/seo";
import ReleaseView from "./ReleaseView";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadStaticEventRelease(id);
  return loaded.data
    ? buildPageMetadata({
        title: `${loaded.data.event.title} | Release`,
        description: "イベントの公開作品一覧",
        path: `/event/${loaded.data.event.id}/release`,
        noIndex: false,
      })
    : { title: "Release" };
}

export default async function EventReleasePage({ params }: Props) {
  const { id } = await params;
  const loaded = await loadStaticEventRelease(id);
  if (!loaded.data) {
    if (loaded.state === "not_found") notFound();
    if (loaded.state === "reflecting") return <PublicReflectionPendingNotice />;
    return <PublicDataUnavailableNotice />;
  }
  const { event, videos, total, truncated } = loaded.data;
  return (
    <main className={`fn-public-container fn-page ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <p className="fn-eyebrow">RELEASE</p>
          <h1>{event.title}</h1>
          <p className={styles.lead}>公開作品一覧</p>
        </div>
        <Link className="fn-btn fn-btn-ghost fn-btn-sm" href={`/event/${encodeURIComponent(event.id)}`}>
          イベント詳細へ
        </Link>
      </header>
      <p className={styles.summary}>{total}作品{truncated ? "（先頭500作品を表示）" : ""}</p>
      <ReleaseView videos={videos} />
    </main>
  );
}
