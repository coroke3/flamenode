import { redirect } from "next/navigation";

// /admin/history は旧 legacy ページ。
// 現在は /admin/audit (フィルタ / 差分表示 / クエリパラメータ対応の上位版) に統合済み。
// サイドバーや /admin の「直近の管理操作」も /admin/audit を指す。
// 既存ブックマーク / 外部リンクが切れないよう、ここでは永続リダイレクトで /admin/audit に流す。
export default function AdminHistoryPage(): never {
  redirect("/admin/audit");
}
