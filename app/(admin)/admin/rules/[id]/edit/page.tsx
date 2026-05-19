import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { termsVersions } from "@/lib/db/schema";
import { TermsForm } from "@/components/admin/TermsForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "利用規約バージョン編集" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminRulesEditPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();
  const row = (
    await db.select().from(termsVersions).where(eq(termsVersions.id, id)).limit(1)
  )[0];
  if (!row) notFound();

  return (
    <div>
      <AdminPageHeader
        title={`${row.version_label} を編集`}
        backHref="/admin/rules"
        backLabel="規約一覧へ"
      />
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        状態:{" "}
        <span
          className={`fn-badge ${
            row.status === "published"
              ? "fn-badge-accent"
              : row.status === "archived"
                ? "fn-badge-neutral"
                : "fn-badge-soft"
          }`}
        >
          {row.status}
        </span>
        {row.severity ? (
          <span className="fn-badge fn-badge-soft" style={{ marginLeft: 6 }}>
            {row.severity}
          </span>
        ) : null}
      </p>

      <section
        style={{
          marginTop: 18,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <TermsForm
          mode="edit"
          initial={{
            id: row.id,
            version_label: row.version_label,
            body_markdown: row.body_markdown,
            severity: (row.severity ?? "minor") as "minor" | "major",
            status: (row.status ?? "draft") as "draft" | "published" | "archived",
          }}
        />
      </section>

    </div>
  );
}
