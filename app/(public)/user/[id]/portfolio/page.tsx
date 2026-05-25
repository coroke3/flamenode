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
    <main style={{ width: "min(96%, 760px)", margin: "0 auto", padding: "32px 16px 72px" }}>
      <div style={{ marginBottom: 18 }}>
        <Link href={`/user/${id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
          @{id} に戻る
        </Link>
      </div>
      <section className="fn-card">
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Portfolio は準備中です
        </h1>
        <p className="fn-muted fn-text-sm">
          custom_pages / custom_themes は初期本番では無効化しています。
        </p>
      </section>
    </main>
  );
}
