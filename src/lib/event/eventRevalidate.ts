import { revalidatePath } from "next/cache";

export function revalidateEventPaths(eventId: string): void {
  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/manage");
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath(`/manage/events/${eventId}/edit`);
  revalidatePath("/event");
  revalidatePath(`/event/${eventId}`);
}

export function revalidateEventListPaths(): void {
  revalidatePath("/admin/events");
  revalidatePath("/manage");
  revalidatePath("/event");
}
