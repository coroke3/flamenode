import * as React from "react";
import type { Metadata } from "next";
import { TermsForm } from "@/components/admin/TermsForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata: Metadata = { title: "新規利用規約バージョン" };
export const dynamic = "force-dynamic";

export default function AdminRulesNewPage(): React.ReactElement {
  return (
    <div>
      <AdminPageHeader
        title="新規利用規約バージョン"
        description="下書きとして保存し、編集ページから公開してください。major リリースで公開すると全ユーザーに再同意を要求します。"
        backHref="/admin/rules"
        backLabel="規約一覧へ"
      />

      <section
        style={{
          marginTop: 18,
          padding: "20px 22px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <TermsForm mode="create" />
      </section>
    </div>
  );
}
