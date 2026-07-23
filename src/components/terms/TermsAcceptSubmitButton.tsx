"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";

export function TermsAcceptSubmitButton(): React.ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="fn-btn fn-btn-primary"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "同意状態を保存中…" : "利用規約に同意して戻る"}
    </button>
  );
}
