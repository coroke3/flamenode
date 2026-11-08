/**
 * Preserve CURRENT top-page announcement limit (179 UTF-16 code units + "...")
 * without leaving half of a surrogate pair at the cutoff.
 */
export function truncateAnnouncementBody(body: string): string {
  if (body.length <= 180) return body;
  const end = 179;
  const last = body.charCodeAt(end - 1);
  const safeEnd = last >= 0xd800 && last <= 0xdbff ? end - 1 : end;
  return `${body.slice(0, safeEnd)}...`;
}
