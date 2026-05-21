import { redirect } from "next/navigation";

// /admin/history は旧URL。現在の監査ログ画面へ恒久的に寄せる。
export default function AdminHistoryPage(): never {
  redirect("/admin/audit");
}
