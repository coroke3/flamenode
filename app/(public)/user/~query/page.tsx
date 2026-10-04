import type * as React from "react";
import { UserListPage } from "../UserIndexView";

export { metadata } from "../UserIndexView";

// `/user?…` requests are rewritten here (next.config.mjs) so that
// `/user` itself can be served from the ISR cache. Reading the query keeps
// this route rendered per request. `~` cannot appear in IDs, so this segment
// never shadows a detail page.
export default function QueryPage(
  props: Parameters<typeof UserListPage>[0],
): Promise<React.ReactElement> {
  return UserListPage(props);
}
