import "server-only";

import { cache } from "react";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

// Auth.jsのauthはmiddleware用overloadも持つため、引数なしのServer Component呼出しを明示する。
const loadAuthSession = auth as unknown as () => Promise<Session | null>;

/**
 * OAuth callback直後など、同一request内で意図的に再読込する場合だけ使う。
 * 通常のServer Componentは重複queryを避けるため getAuthSession を使う。
 */
export async function loadAuthSessionUncached(): Promise<Session | null> {
  return loadAuthSession();
}

/** 同一Server Component request内のauth()を1回にまとめる。 */
export const getAuthSession = cache(loadAuthSession);
