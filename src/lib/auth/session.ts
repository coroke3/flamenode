import "server-only";

import { cache } from "react";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

// Auth.jsのauthはmiddleware用overloadも持つため、引数なしのServer Component呼出しを明示する。
const loadAuthSession = auth as unknown as () => Promise<Session | null>;

/** 同一Server Component request内のauth()を1回にまとめる。 */
export const getAuthSession = cache(loadAuthSession);
