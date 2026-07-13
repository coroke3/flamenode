type SerializedEnv = { DB: D1Database };

type AsyncStatementMethod = "all" | "first" | "run" | "raw";

const ASYNC_STATEMENT_METHODS = new Set<PropertyKey>([
  "all",
  "first",
  "run",
  "raw",
] satisfies AsyncStatementMethod[]);

class AsyncGate {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/**
 * 同じWorker invocation内のD1処理を直列化する。
 * D1はdatabase単位でqueryを1本ずつ処理し、Workers Freeは同時接続数6のため、
 * Promise.allで多数のqueryを開始してもthroughputは増えず接続枠だけを消費する。
 */
export function withSerializedD1<Env extends SerializedEnv>(env: Env): Env {
  const gate = new AsyncGate();
  const originalStatement = new WeakMap<object, D1PreparedStatement>();

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement as object, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(statement.bind(...values));
        }
        if (ASYNC_STATEMENT_METHODS.has(property)) {
          const method = Reflect.get(target, property, target);
          if (typeof method !== "function") return method;
          return (...args: unknown[]) =>
            gate.run(() => Reflect.apply(method, statement, args));
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(statement) : value;
      },
    }) as D1PreparedStatement;
    originalStatement.set(wrapped as object, statement);
    return wrapped;
  };

  const database = new Proxy(env.DB as object, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(env.DB.prepare(query));
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) =>
          gate.run(() =>
            env.DB.batch(
              statements.map(
                (statement) =>
                  originalStatement.get(statement as object) ?? statement,
              ),
            ),
          );
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(env.DB) : value;
    },
  }) as D1Database;

  return { ...env, DB: database };
}
