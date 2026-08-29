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
  const { event, videos, truncated } = loaded.data;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>投稿予定のご案内</h1>
        <Link className={styles.eventTitleLink} href={`/event/${encodeURIComponent(event.id)}`}>
          {event.title}
        </Link>
      </header>
      <ReleaseView videos={videos} truncated={truncated} />
    </div>
  );
}
