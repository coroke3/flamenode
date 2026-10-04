import type * as React from "react";
import { EventListPage } from "../EventIndexView";

export { metadata } from "../EventIndexView";

// `/event?…` requests are rewritten here (next.config.mjs) so that
// `/event` itself can be served from the ISR cache. Reading the query keeps
// this route rendered per request. `~` cannot appear in IDs, so this segment
// never shadows a detail page.
export default function QueryPage(
  props: Parameters<typeof EventListPage>[0],
): Promise<React.ReactElement> {
  return EventListPage(props);
}
