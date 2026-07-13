"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleDelete = () => {
    setConfirmOpen(false);
    setError(null);

    const formData = new FormData();
    formData.set("template_id", templateId);

    startTransition(async () => {
      const result = await deleteEventTemplate(formData);

      if (!result.ok) {
        setError(result.message ?? "削除に失敗しました。");
        return;
      }

      router.refresh();
    });
  };

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
      }}
    >
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
      >
        {busy ? "削除中…" : "削除"}
      </button>

      {error ? (
        <span role="alert" style={{ color: "var(--accent-danger)", fontSize: 10 }}>
          {error}
        </span>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="イベントテンプレートを削除"
        message={`テンプレート「${templateName}」を削除します。`}
        confirmLabel="削除する"
        tone="danger"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </span>
  );
}
