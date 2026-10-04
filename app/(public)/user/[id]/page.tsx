import type * as React from "react";
import {
  UserProfilePage,
  type UserProfilePageProps,
} from "./UserProfilePage";

export { generateMetadata } from "./UserProfilePage";

export const revalidate = 30;

// On-demand ISR: see app/(public)/event/[id]/page.tsx. This route renders the
// first page of each section only; `?worksPage=` / `?collabPage=` requests are
// rewritten to the dynamic `paged/` route (next.config.mjs), so the cached
// HTML never depends on the query string.
export function generateStaticParams(): { id: string }[] {
  return [];
}

export default function UserPage({
  params,
}: Pick<UserProfilePageProps, "params">): Promise<React.ReactElement> {
  return UserProfilePage({ params });
}
