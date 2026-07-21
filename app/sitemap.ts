
import type { MetadataRoute } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { publicListableEventWhere } from "@/lib/utils/eventStatus";
import { withDatabase } from "@/lib/cloudflare";
import { events, videos, xUsers } from "@/lib/db/schema";
import { absoluteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

type SitemapEntry = MetadataRoute.Sitemap[number];

function unixDate(value: number | null | undefined): Date | undefined {
  return value == null ? undefined : new Date(Number(value) * 1000);
}

function entry(
  path: string,
  options: {
    lastModified?: Date;
    changeFrequency?: SitemapEntry["changeFrequency"];
    priority?: number;
  } = {},
): SitemapEntry {
  return {
    url: absoluteUrl(path),
    lastModified: options.lastModified ?? new Date(),
    changeFrequency: options.changeFrequency,
    priority: options.priority,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    entry("/", { changeFrequency: "daily", priority: 1 }),
    entry("/recommend", { changeFrequency: "daily", priority: 0.8 }),
    entry("/list", { changeFrequency: "daily", priority: 0.8 }),
    entry("/event", { changeFrequency: "daily", priority: 0.7 }),
    entry("/user", { changeFrequency: "weekly", priority: 0.6 }),
    entry("/about", { changeFrequency: "monthly", priority: 0.4 }),
    entry("/rules", { changeFrequency: "monthly", priority: 0.3 }),
  ];

  const dynamicEntries =
    (await withDatabase(async (db) => {
      const [videoRows, eventRows, creatorRows] = await Promise.all([
        db
          .select({
            id: videos.id,
            youtube_video_id: videos.youtube_video_id,
            updated_at: videos.updated_at,
            scheduled_time: videos.scheduled_time,
          })
          .from(videos)
          .where(eq(videos.visibility_status, "public"))
          .orderBy(desc(videos.updated_at))
          .limit(500),
        db
          .select({
            id: events.id,
            updated_at: events.updated_at,
            start_time: events.start_time,
          })
          .from(events)
          .where(publicListableEventWhere())
          .orderBy(desc(events.updated_at))
          .limit(200),
        db
          .select({
            id: xUsers.id,
            updated_at: sql<number | null>`MAX(COALESCE(${videos.updated_at}, ${videos.scheduled_time}, ${videos.created_at}))`,
          })
          .from(xUsers)
          .innerJoin(videos, eq(videos.creator_x_user_id, xUsers.id))
          .where(eq(videos.visibility_status, "public"))
          .groupBy(xUsers.id)
          .orderBy(desc(sql`MAX(COALESCE(${videos.updated_at}, ${videos.scheduled_time}, ${videos.created_at}))`))
          .limit(300),
      ]);

      return [
        ...videoRows.map((video) =>
          entry(`/${encodeURIComponent(video.youtube_video_id ?? video.id)}`, {
            lastModified: unixDate(video.updated_at ?? video.scheduled_time),
            changeFrequency: "weekly",
            priority: 0.7,
          }),
        ),
        ...eventRows.map((event) =>
          entry(`/event/${encodeURIComponent(event.id)}`, {
            lastModified: unixDate(event.updated_at ?? event.start_time),
            changeFrequency: "weekly",
            priority: 0.7,
          }),
        ),
        ...creatorRows.map((creator) =>
          entry(`/user/${encodeURIComponent(creator.id)}`, {
            lastModified: unixDate(creator.updated_at),
            changeFrequency: "weekly",
            priority: 0.6,
          }),
        ),
      ];
    })) ?? [];

  return [...staticEntries, ...dynamicEntries];
}
