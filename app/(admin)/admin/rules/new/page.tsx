import * as React from "react";
import type { Metadata } from "next";
import { TermsForm } from "@/components/admin/TermsForm";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { ConsolePanel } from "@/components/layout/ConsolePanel";
import {
  DEFAULT_TERMS_MARKDOWN,
  DEFAULT_TERMS_VERSION_LABEL,
} from "@/lib/terms/defaultTerms";

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

      <ConsolePanel>
        <TermsForm
          mode="create"
          initial={{
            version_label: DEFAULT_TERMS_VERSION_LABEL,
            body_markdown: DEFAULT_TERMS_MARKDOWN,
            severity: "major",
          }}
        />
      </ConsolePanel>
    </div>
  );
}
