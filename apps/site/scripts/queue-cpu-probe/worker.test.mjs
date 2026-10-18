import { test } from "node:test";
import assert from "node:assert/strict";
import probe from "./worker.ts";

test("U07 probe: only POST /send with ms in {20,100,1000} and count 1..50 enqueues", async () => {
  const sent = [];
  const env = { PROBE_QUEUE: { sendBatch: async (batch) => { sent.push(...batch); } } };
  for (const url of ["https://p/send?ms=5", "https://p/send?ms=20&count=51", "https://p/send?ms=20&count=0", "https://p/other?ms=20"]) {
    assert.notEqual((await probe.fetch(new Request(url, { method: "POST" }), env)).status, 200, url);
  }
  assert.equal((await probe.fetch(new Request("https://p/send?ms=20"), env)).status, 404);
  assert.equal(sent.length, 0);
  const res = await probe.fetch(new Request("https://p/send?ms=100&count=50", { method: "POST" }), env);
  assert.deepEqual(await res.json(), { queued: 50, ms: 100 });
  assert.equal(sent.length, 50);
  assert.deepEqual(sent[49].body, { ms: 100, seq: 49 });
});

test("U07 probe: the consumer acks every message and burns ~ms of CPU (local Node calibration)", async () => {
  let acked = 0;
  const log = console.log;
  console.log = () => {};
  try {
    const start = process.cpuUsage();
    await probe.queue({ messages: [{ body: { ms: 20, seq: 0 }, ack: () => { acked++; } }, { body: { ms: 7, seq: 1 }, ack: () => { acked++; } }] });
    const cpuMs = (process.cpuUsage(start).user + process.cpuUsage(start).system) / 1000;
    assert.equal(acked, 2);
    assert.ok(cpuMs > 5 && cpuMs < 200, `cpu ${cpuMs}`);
  } finally {
    console.log = log;
  }
});
