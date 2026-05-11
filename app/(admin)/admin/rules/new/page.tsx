import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";
import { TermsForm } from "@/components/admin/TermsForm";

export const metadata: Metadata = { title: "新規利用規約バージョン" };

export default function AdminRulesNewPage(): React.ReactElement {
  return (
    <div>
      <p className="fn-muted fn-text-xs fn-bold">RULES NEW</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>新規利用規約バージョン</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        下書きとして保存し、編集ページから公開してください。major リリースで公開すると全ユーザーに再同意を要求します。
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
        <TermsForm mode="create" />
      </section>

      <p style={{ marginTop: 22 }}>
        <Link href="/admin/rules" className="fn-btn fn-btn-ghost">
          <Icon name="chevron-left" size={12} aria-hidden /> 一覧へ戻る
        </Link>
      </p>
    </div>
  );
}
