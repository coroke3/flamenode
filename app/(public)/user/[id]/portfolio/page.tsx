import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { normalizeXId } from "@/lib/utils/xid";

export const metadata: Metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PortfolioPage({
  params,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);

  return (
    <main className="fn-public-container fn-page">
      <header className="fn-page-head">
        <Link href={`/user/${id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
          @{id} に戻る
        </Link>
        <h1 className="fn-page-title">Portfolio</h1>
        <p className="fn-page-lead">準備中の機能です</p>
      </header>
      <section className="fn-card">
        <h2 className="fn-panel-title">Portfolio は準備中です</h2>
        <p className="fn-muted fn-text-sm">
          custom_pages / custom_themes は初期本番では無効化しています。
        </p>
      </section>
    </main>
  );
}
