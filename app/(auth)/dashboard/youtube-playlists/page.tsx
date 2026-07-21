import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "再生リスト同期状況" };
export const dynamic = "force-dynamic";

/**
 * 一般ユーザー向けの同期状況画面は提供しない。
 * 管理者は全体管理画面、イベント運営は各イベントの運営画面で確認する。
 */
export default async function DashboardYoutubePlaylistsPage() {
  const guard = await requireSession({ next: "/dashboard/youtube-playlists" });
  if (!guard.ok) return guard.element;

  if (guard.user.role === "admin") {
    redirect("/admin/youtube-sync/playlists");
  }
  redirect("/dashboard");
}
