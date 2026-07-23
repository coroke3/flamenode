import type { XIdEntry } from "@/lib/xid/entries";

export type AccountSummaryLoggedOut = {
  loggedIn: false;
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
};

export type AccountSummaryResponse =
  | AccountSummaryLoggedOut
  | AccountSummaryLoggedIn;
