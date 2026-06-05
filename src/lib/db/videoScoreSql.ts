import { asc, desc, sql } from "drizzle-orm";
import { videos } from "./schema";

/** videos.score（0024+）。video_stats は参照しない（DB削減後）。 */
export const coalescedVideoScore = sql<number>`COALESCE(${videos.score}, 0)`;

export const coalescedVideoScoreDesc = desc(coalescedVideoScore);
export const coalescedVideoScoreAsc = asc(coalescedVideoScore);
