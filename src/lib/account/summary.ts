import type { XIdEntry } from "@/lib/xid/entries";

export type AccountSummaryLoggedOut = {
  loggedIn: false;
  /** DB/認証基盤の一時障害。クライアントは既存のログイン表示を維持する。 */
  unavailable?: true;
};

export type AccountSummaryLoggedIn = {
  loggedIn: true;
  displayName: string;
  icon: string | null;
  role: "user" | "admin" | "moderator";
  activeXId: string | null;
  xIds: XIdEntry[];
  canAccessAdmin: boolean;
  canAccessManage: boolean;
  /** header 追加情報の取得失敗。管理フラグは不完全な可能性がある。 */
  degraded?: true;
};

export type AccountSummaryResponse =
  | AccountSummaryLoggedOut
  | AccountSummaryLoggedIn;
