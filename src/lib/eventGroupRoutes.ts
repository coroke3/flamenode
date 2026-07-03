export function eventGroupAnchorId(slug: string): string {
  return `event-group-${slug}`;
}

export function eventGroupPublicHref(slug: string): string {
  return `/event#${eventGroupAnchorId(slug)}`;
}
