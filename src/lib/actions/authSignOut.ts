"use server";

import { unstable_rethrow } from "next/navigation";
import { signOut } from "@/lib/auth";

export type AuthSignOutResult =
  | { ok: true }
  | { ok: false; message: string };

export async function authSignOut(): Promise<AuthSignOutResult> {
  try {
    await signOut({ redirect: false });
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[authSignOut] failed", error);
    return {
      ok: false,
      message: "ログアウトに失敗しました。再読み込みしてもう一度お試しください。",
    };
  }
}
