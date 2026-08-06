"use client";

import * as React from "react";
import { authSignOut } from "@/lib/actions/authSignOut";

type SignOutButtonProps = {
  className?: string;
  children?: React.ReactNode;
  onBeforeSignOut?: () => void;
};

export function SignOutButton({
  className,
  children,
  onBeforeSignOut,
}: SignOutButtonProps): React.ReactElement {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleClick = React.useCallback(() => {
    if (pending) return;
    setError(null);
    onBeforeSignOut?.();
    startTransition(async () => {
      try {
        const result = await authSignOut();
        if (result.ok) {
          window.location.replace("/entry");
          return;
        }
        setError(result.message);
      } catch {
        setError(
          "ログアウトに失敗しました。再読み込みしてもう一度お試しください。",
        );
      }
    });
  }, [onBeforeSignOut, pending]);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        aria-busy={pending}
        onClick={handleClick}
      >
        {children ?? (pending ? "ログアウト中…" : "ログアウト")}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
