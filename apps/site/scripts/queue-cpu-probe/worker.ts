/**
 * MIG-0409 U07 probe — NON-PRODUCTION ONLY. Approved 2026-10-18 for a throwaway Worker
 * `flamenode-u07-queue-cpu-probe` and Queue `flamenode-u07-queue-cpu-probe`, deleted after the
 * run (steps in docs/migration/static-delivery/BUILD_TIME_DATA.md §4 U07). No bindings
 * besides the Queue: it reads and writes no FlameNode data.
 *
 *   POST /send?ms=20&count=50   -> enqueue `count` (≤ 50) messages that each burn `ms` CPU
 *
 * Workers freeze Date.now() / performance.now() during execution, so the consumer cannot
 * time itself: it runs a fixed number of loop iterations, ITERATIONS_PER_MS × ms, calibrated
 * locally (Node 22, Intel Xeon 2.80 GHz: 183,000–185,000 iterations per CPU ms). The real
 * CPU time and the outcome (`exceededCpu` or `ok`) of each invocation are read from Workers
 * Observability / `wrangler tail`, not from this code.
 */
const ALLOWED_MS = new Set([20, 100, 1000]);
const MAX_COUNT = 50;
export const ITERATIONS_PER_MS = 184_000;

type ProbeMessage = { ms: number; seq: number };

interface Env {
  PROBE_QUEUE: { sendBatch: (messages: { body: ProbeMessage }[]) => Promise<unknown> };
}

export function burn(ms: number): number {
  const iterations = ms * ITERATIONS_PER_MS;
  let x = 0;
  for (let i = 0; i < iterations; i++) x = (x * 31 + i) % 1_000_003;
  return x;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/send") return new Response("not found", { status: 404 });
    const ms = Number(url.searchParams.get("ms"));
    const count = Number(url.searchParams.get("count") ?? MAX_COUNT);
    if (!ALLOWED_MS.has(ms) || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      return new Response("ms must be 20, 100 or 1000; count 1..50", { status: 400 });
    }
    await env.PROBE_QUEUE.sendBatch(Array.from({ length: count }, (_, seq) => ({ body: { ms, seq } })));
    return Response.json({ queued: count, ms });
  },

  async queue(batch: { messages: readonly { body: ProbeMessage; ack: () => void }[] }): Promise<void> {
    for (const message of batch.messages) {
      const ms = ALLOWED_MS.has(message.body?.ms) ? message.body.ms : 0;
      const value = burn(ms);
      console.log(JSON.stringify({ probe: "u07", ms, seq: message.body?.seq, value }));
      message.ack();
    }
  },
};
