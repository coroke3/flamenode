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
  const meteredStatement = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, property) {
        if (property === "bind") return (...args: unknown[]) => {
          assertOpen();
          return meteredStatement(Reflect.apply(target.bind, target, args));
        };
        if (property === "first" || property === "all" || property === "raw") {
          const method = Reflect.get(target, property, target);
          return (...args: unknown[]) => {
            nextRead();
            return Reflect.apply(method, target, args);
          };
        }
        if (property === "run") return forbidden;
        const value = Reflect.get(target, property, target);
        // Any newly introduced D1 statement method fails closed rather
        // than silently executing an unmetered query or write.
        return typeof value === "function" ? forbidden : value;
      },
    });
  const binding = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          assertOpen();
          return meteredStatement(target.prepare(sql));
        };
      }
      if (property === "batch" || property === "exec" ||
          property === "dump" || property === "withSession") return forbidden;
      const value = Reflect.get(target, property, target);
      // Protect against new D1 write/query methods not in this allowlist.
      return typeof value === "function" ? forbidden : value;
    },
  });
  return {
    binding,
    readCount: () => reads,
    close: () => {
      closed = true;
      return reads;
    },
  };
}
