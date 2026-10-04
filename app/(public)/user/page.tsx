import type * as React from "react";
import { UserListPage } from "./UserIndexView";

export { metadata } from "./UserIndexView";

// Renders the default view only. URLs with a query are rewritten to the
// dynamic `~query/` route (next.config.mjs), so this HTML can be cached.
export const revalidate = 30;

export default function Page(): Promise<React.ReactElement> {
  return UserListPage({ searchParams: Promise.resolve({}) });
}
