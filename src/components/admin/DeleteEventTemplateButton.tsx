"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { deleteEventTemplate } from "@/lib/actions/event-template-admin";

interface DeleteEventTemplateButtonProps {
  templateId: string;
  templateName: string;
}

export function DeleteEventTemplateButton({
  templateId,
  templateName,
}: DeleteEventTemplateButtonProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();

  return (
    <button
      type="button"
      className="fn-btn fn-btn-ghost fn-btn-sm"
      disabled={busy}
      onClick={() => {
        if (
          !window.confirm(
            `テンプレート「${templateName}」を削除します。よろしいですか？`,
          )
        ) {
          return;
        }
        const fd = new FormData();
        fd.set("template_id", templateId);
        startTransition(async () => {
          const r = await deleteEventTemplate(fd);
          if (!r.ok) {
            window.alert(r.message ?? "削除に失敗しました。");
            return;
          }
          router.refresh();
        });
      }}
    >
      {busy ? "削除中…" : "削除"}
    </button>
  );
}
