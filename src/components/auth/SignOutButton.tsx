"use client";

import * as React from "react";
import { signOutViaAuthRoute } from "@/lib/client/authSignOutClient";

type SignOutButtonProps = {
  className?: string;
  children?: React.ReactNode;
};

export function SignOutButton({
  className,
  children,
}: SignOutButtonProps): React.ReactElement {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleClick = React.useCallback(async () => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await signOutViaAuthRoute();
      if (result.ok) {
        window.location.replace("/");
        return;
      }
      setError(result.message);
    } catch {
      setError(
        "ログアウトに失敗しました。再読み込みしてもう一度お試しください。",
      );
    } finally {
      setPending(false);
    }
  }, [pending]);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        aria-busy={pending}
        onClick={handleClick}
      >
        {pending ? "ログアウト中…" : (children ?? "ログアウト")}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
