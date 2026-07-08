import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminEventDetailRedirectPage({
  params,
}: Props): Promise<never> {
  const { id } = await params;
  redirect(`/manage/events/${encodeURIComponent(id)}`);
}
