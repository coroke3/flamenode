import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
import { customPages, xUsers } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { sanitizeUserHtml } from "@/lib/utils/sanitizeUserHtml";
import { sanitizeUserCss } from "@/lib/utils/sanitizeUserCss";

export const metadata: Metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PortfolioPage({
  params,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);
  const bundle = await withDatabase(async (db) => {
    const x = (await db.select().from(xUsers).where(sql`lower(${xUsers.id}) = ${id}`).limit(1))[0];
    if (!x) return null;
    const page = (
      await db
        .select()
        .from(customPages)
        .where(and(sql`lower(${customPages.x_user_id}) = ${id}`, eq(customPages.is_published, 1))!)
        .limit(1)
    )[0];
    if (!page) return null;
    return { x, page };
  });
  if (!bundle) notFound();
  const { x, page } = bundle;

  return (
    <main style={{ width: "min(96%, 960px)", margin: "0 auto", padding: "32px 16px 72px" }}>
      <div style={{ marginBottom: 18 }}>
        <Link href={`/user/${id}`} className="fn-btn fn-btn-ghost fn-btn-sm">
          @{id} に戻る
        </Link>
      </div>
      <article
        className="fn-custom-page"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          padding: 24,
        }}
      >
        {page.css ? <style>{sanitizeUserCss(page.css)}</style> : null}
        <div
          dangerouslySetInnerHTML={{
            __html: sanitizeUserHtml(
              page.html ?? `<h1>${x.x_name ?? ""}</h1>`,
            ),
          }}
        />
      </article>
    </main>
  );
}
