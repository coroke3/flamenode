import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
}

/** 旧 URL → 審査キューへリダイレクト */
export default async function ManageEventReviewRedirect({
  params,
}: Props): Promise<never> {
  const { id } = await params;
  redirect(`/manage/events/${encodeURIComponent(id)}/videos?status=pending`);
}
