import type * as React from "react";
import { ListPage } from "../ListIndexView";

export { metadata } from "../ListIndexView";

// `/list?…` requests are rewritten here (next.config.mjs) so that
// `/list` itself can be served from the ISR cache. Reading the query keeps
// this route rendered per request. `~` cannot appear in IDs, so this segment
// never shadows a detail page.
export default function QueryPage(
  props: Parameters<typeof ListPage>[0],
): Promise<React.ReactElement> {
  return ListPage(props);
}
