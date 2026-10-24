/**
 * The SQL template tag a host route uses to write a mutation statement for `mutateWithAudit`.
 * Hosts import it from here so that drizzle-orm stays a server-core detail (MIG-0617 L2,
 * `scripts/check-server-core-boundaries.mjs` forbids `drizzle-orm` in apps/api/src/routes).
 */
export { sql } from "drizzle-orm";
export type { SQL } from "drizzle-orm";
