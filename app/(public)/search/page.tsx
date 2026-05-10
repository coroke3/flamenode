import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "検索",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<never> {
  const { q = "" } = await searchParams;
  // 検索 UI は /list に統合済みなので、クエリ付きでリダイレクトする
  redirect(q ? `/list?q=${encodeURIComponent(q)}` : "/list");
}
