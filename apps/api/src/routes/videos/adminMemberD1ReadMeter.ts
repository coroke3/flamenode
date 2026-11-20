/**
 * MIG-0650 U03bm — UNMOUNTED SA-085 request-local D1 READ meter.
 *
 * A future Hono host must install binding at the very beginning of its
 * authenticated guard chain, BEFORE the actor, CostGuard, target video,
 * canonical member and chapter reads. Every such read must use binding,
 * including the Drizzle instance given to canonical planners.
 *
 * This wrapper is deliberately READ-ONLY. Never use it to commit writes:
 * the already-validated atomic executor receives the separately authorized
 * real D1/Drizzle handle after the count has been sealed. Importing this
 * module cannot register a route or access a live D1 binding.
 */
import { D1_MAX_BATCH_QUERIES } from "@flamenode/server-core/audit/mutateBudget";

const FORBIDDEN = "video_admin_member_d1_read_meter_mutation_forbidden";
const CLOSED = "video_admin_member_d1_read_meter_closed";
const OVER_BUDGET = "video_admin_member_d1_read_limit_exceeded";

/**
 * The meter must NEVER be allowed to execute DML disguised as a "read":
 * D1 supports INSERT...RETURNING through all/first/raw as well as run().
 *
 * All CURRENT SA-085 guard + canonical planner reads are SELECT statements.
 * Reject semicolons (even a final one), leading SQL comments and CTEs rather
 * than attempting to parse arbitrary multi-statement or write-capable SQL.
 * This is deliberately narrower than generic SQLite syntax.
 */
function assertReadOnlySql(sql: string): void {
  if (typeof sql !== "string" || !/^\s*select\b/i.test(sql) ||
      sql.includes(";") ||
      // SQLite may expose side-effect functions through SELECT, including
      // quoted function identifiers. SA-085 only runs fixed D1 lookup SQL;
      // reject these names even inside literals/comments rather than trying
      // to safely evaluate arbitrary SQLite expressions in this meter.
      /\b(?:load_extension|writefile)\b/i.test(sql)) {
    throw new RangeError(FORBIDDEN);
  }
}

export type AdminMemberD1ReadMeter = {
  /** No write, batch, exec, dump or session entrypoints are accessible. */
  binding: D1Database;
  /** Actual logical SELECT queries executed in this request. */
  readCount: () => number;
  /** Prevent any further request reads after the atomic plan is prepared. */
  close: () => number;
};

/**
 * Wrap one D1 binding per request, not one wrapper per query. Binding SQL
 * parameters does not consume a D1 query; first/all/raw do, exactly once each.
 * Denied/failed reads also count because the provider call was attempted.
 */
export function createAdminMemberD1ReadMeter(db: D1Database): AdminMemberD1ReadMeter {
  if (!db || typeof db.prepare !== "function") {
    throw new RangeError("video_admin_member_d1_read_meter_invalid_binding");
  }
  let reads = 0;
  let closed = false;
  const assertOpen = () => {
    if (closed) throw new RangeError(CLOSED);
  };
  const forbidden = (): never => { throw new RangeError(FORBIDDEN); };
  const nextRead = () => {
    assertOpen();
    if (reads >= D1_MAX_BATCH_QUERIES) throw new RangeError(OVER_BUDGET);
    reads++;
  };
  // Expose a blank facade, NOT a Proxy whose target is the real statement.
  // Reflective operations and host-specific object-valued properties must
  // never expose an unmetered D1 handle to a future Hono caller.
  const meteredStatement = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(Object.create(null), {
      get(_facade, property) {
        if (property === "bind") return (...args: unknown[]) => {
          assertOpen();
          return meteredStatement(Reflect.apply(stmt.bind, stmt, args));
        };
        if (property === "first" || property === "all" || property === "raw") {
          const method = Reflect.get(stmt, property, stmt);
          return (...args: unknown[]) => {
            nextRead();
            return Reflect.apply(method, stmt, args);
          };
        }
        if (property === "run") return forbidden;
        // No other properties, including any provider-owned object, getters,
        // extension methods or reflective backing target, are exposed.
        return undefined;
      },
    });
  const binding = new Proxy(Object.create(null), {
    get(_facade, property) {
      if (property === "prepare") {
        return (sql: string) => {
          assertOpen();
          assertReadOnlySql(sql);
          return meteredStatement(db.prepare(sql));
        };
      }
      if (property === "batch" || property === "exec" ||
          property === "dump" || property === "withSession") return forbidden;
      // An unknown non-function object (such as a raw provider connection)
      // can be just as unsafe as an unknown method. Expose neither; no getter
      // on the raw D1 binding is evaluated through this facade.
      return undefined;
    },
  }) as D1Database;
  return {
    binding,
    readCount: () => reads,
    close: () => {
      closed = true;
      return reads;
    },
  };
}

/**
 * MIG-0650 U03bp: seal the authenticated SA-085 request's read counter
 * BEFORE obtaining the separate write-only D1 handle for atomic execution.
 * The sealed count must match what prepareAdminVideoMemberCandidateWrite
 * recorded after its canonical reads. A mismatch rejects even a valid-looking
 * mutation plan, and the meter stays closed on rejection (no retry/bypass).
 * This helper does NOT authorize, execute or mount the Hono save route.
 */
export function sealAdminMemberD1ReadMeter(
  meter: AdminMemberD1ReadMeter,
  expectedCallerQueryCount: number,
): number {
  const actualCount = meter.close();
  // Close first: invalid expected counts must not leave a live read facade.
  if (!Number.isSafeInteger(expectedCallerQueryCount) ||
      expectedCallerQueryCount < 0 ||
      actualCount !== expectedCallerQueryCount) {
    throw new RangeError("video_admin_member_d1_read_meter_count_mismatch");
  }
  return actualCount;
}
