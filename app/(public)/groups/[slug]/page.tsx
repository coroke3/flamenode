import { redirect } from "next/navigation";
import { eventGroupPublicHref } from "@/lib/eventGroupRoutes";

export default async function GroupDetailRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<never> {
  const { slug } = await params;
  redirect(eventGroupPublicHref(slug));
}
