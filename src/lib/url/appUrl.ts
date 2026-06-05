/**
 * Discord DM 等で使う絶対 URL を組み立てる。
 */
export function appUrl(path: string): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_ORIGIN ||
    "http://localhost:3000";

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/$/, "")}${normalizedPath}`;
}

export function videoPublicPath(videoId: string, youtubeVideoId?: string | null): string {
  const slug = youtubeVideoId?.trim() || videoId;
  return `/${slug}`;
}
