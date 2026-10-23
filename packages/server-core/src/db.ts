import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "@flamenode/db/schema";

/**
 * The drizzle handle every server-core function receives. The host builds it with
 * `drizzle(env.DB, { schema })`; the core never opens a D1 binding itself and never uses
 * the relational `db.query` API.
 */
export type ServerCoreDb = DrizzleD1Database<typeof schema>;
