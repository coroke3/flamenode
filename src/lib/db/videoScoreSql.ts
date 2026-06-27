import { asc, desc, sql } from "drizzle-orm";
import { videos } from "./schema";

/** videos.score is the canonical score after DB reduction. */
export const coalescedVideoScore = sql<number>`COALESCE(${videos.score}, 0)`;

export const coalescedVideoScoreDesc = desc(coalescedVideoScore);
export const coalescedVideoScoreAsc = asc(coalescedVideoScore);
