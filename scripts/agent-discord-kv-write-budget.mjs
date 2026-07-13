#!/usr/bin/env node
import fs from "node:fs";

const path = "workers/notification-dispatcher/dispatch.ts";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one replacement, got ${count}: ${before.slice(0, 80)}`);
  source = source.replace(before, after);
}

replaceOnce(
  `export const MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN = 12;`,
  `export const MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN = 12;\n/** 2 writes/run × 288 runs/day = 最大576 writes/day。KV Freeの余裕を残す。 */\nexport const MAX_DISCORD_DM_KV_WRITES_PER_RUN = 2;`,
);

replaceOnce(
`async function storeDmChannel(env: Env, discordId: string, channelId: string): Promise<void> {
  dmChannelCache.set(discordId, {
    channelId,
    expiresAt: Date.now() + DISCORD_DM_CHANNEL_TTL_SEC * 1_000,
  });
  pruneOldest(dmChannelCache, DISCORD_DM_CHANNEL_CACHE_MAX);
  if (!env.KV) return;
  try {
    await env.KV.put(dmCacheKey(discordId), channelId, {
      expirationTtl: DISCORD_DM_CHANNEL_TTL_SEC,
    });
  } catch {
    // cache保存失敗でも今回の配送は継続する。
  }
}`,
`async function storeDmChannel(
  env: Env,
  discordId: string,
  channelId: string,
  kvWriteBudget: ExternalRequestBudget,
): Promise<void> {
  dmChannelCache.set(discordId, {
    channelId,
    expiresAt: Date.now() + DISCORD_DM_CHANNEL_TTL_SEC * 1_000,
  });
  pruneOldest(dmChannelCache, DISCORD_DM_CHANNEL_CACHE_MAX);
  if (!env.KV || !kvWriteBudget.consume()) return;
  try {
    await env.KV.put(dmCacheKey(discordId), channelId, {
      expirationTtl: DISCORD_DM_CHANNEL_TTL_SEC,
    });
  } catch {
    // cache保存失敗でも今回の配送は継続する。
  }
}`,
);

replaceOnce(
`async function evictDmChannel(env: Env, discordId: string): Promise<void> {
  dmChannelCache.delete(discordId);
  if (!env.KV) return;
  try {
    await env.KV.delete(dmCacheKey(discordId));
  } catch {
    // 次回の404で再度回復できるためbest effort。
  }
}`,
`async function evictDmChannel(
  env: Env,
  discordId: string,
  kvWriteBudget: ExternalRequestBudget,
): Promise<void> {
  dmChannelCache.delete(discordId);
  if (!env.KV || !kvWriteBudget.consume()) return;
  try {
    await env.KV.delete(dmCacheKey(discordId));
  } catch {
    // 次回の404で再度回復できるためbest effort。
  }
}`,
);

replaceOnce(
`  budget: ExternalRequestBudget,
  fetchImpl: FetchLike = fetch,`,
`  budget: ExternalRequestBudget,
  kvWriteBudget: ExternalRequestBudget,
  fetchImpl: FetchLike = fetch,`,
);

replaceOnce(
`    await storeDmChannel(env, row.discord_id, channelId);`,
`    await storeDmChannel(env, row.discord_id, channelId, kvWriteBudget);`,
);

replaceOnce(
`    await evictDmChannel(env, row.discord_id);`,
`    await evictDmChannel(env, row.discord_id, kvWriteBudget);`,
);

replaceOnce(
`  const budget = new ExternalRequestBudget(MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN);
  let processed = 0;`,
`  const budget = new ExternalRequestBudget(MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN);
  const kvWriteBudget = new ExternalRequestBudget(MAX_DISCORD_DM_KV_WRITES_PER_RUN);
  let processed = 0;`,
);

replaceOnce(
`      env,
      budget,
    );`,
`      env,
      budget,
      kvWriteBudget,
    );`,
);

replaceOnce(
`    env,
    new ExternalRequestBudget(2),
  );`,
`    env,
    new ExternalRequestBudget(2),
    new ExternalRequestBudget(1),
  );`,
);

fs.writeFileSync(path, source);
fs.rmSync("scripts/agent-discord-kv-write-budget.mjs");
fs.rmSync(".github/workflows/agent-discord-kv-write-budget.yml");
console.log("Discord KV write budget applied");
