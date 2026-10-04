import type * as React from "react";
import {
  UserProfilePage,
  type UserProfilePageProps,
} from "../UserProfilePage";

export { generateMetadata } from "../UserProfilePage";

// `/user/{id}?worksPage=` and `?collabPage=` are rewritten here
// (next.config.mjs) so that `/user/[id]` itself can be served from the ISR
// cache. Reading the query keeps this route rendered per request.
export default function UserPagedPage(
  props: UserProfilePageProps,
): Promise<React.ReactElement> {
  return UserProfilePage(props);
}
