#!/usr/bin/env node
import fs from "node:fs";

const path = "workers/notification-dispatcher/dispatch.ts";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one replacement, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  `const DISCORD_DM_CHANNEL_CACHE_MAX = 1_000;`,
  `const DISCORD_DM_CHANNEL_CACHE_MAX = 1_000;\nconst DISCORD_GLOBAL_COOLDOWN_KEY = "discord:global";`,
);

replaceOnce(
`function cooldownSeconds(routeKey: string, now = Date.now()): number {
  const until = discordCooldowns.get(routeKey) ?? 0;
  if (until <= now) {
    discordCooldowns.delete(routeKey);
    return 0;
  }
  return Math.max(1, Math.ceil((until - now) / 1_000));
}`,
`function activeCooldownUntil(key: string, now: number): number {
  const until = discordCooldowns.get(key) ?? 0;
  if (until <= now) {
    discordCooldowns.delete(key);
    return 0;
  }
  return until;
}

function cooldownSeconds(routeKey: string, now = Date.now()): number {
  const until = Math.max(
    activeCooldownUntil(DISCORD_GLOBAL_COOLDOWN_KEY, now),
    activeCooldownUntil(routeKey, now),
  );
  return until > 0 ? Math.max(1, Math.ceil((until - now) / 1_000)) : 0;
}`,
);

replaceOnce(
`  let retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    DISCORD_MAX_RETRY_AFTER_MS,
  );
  if (response.status === 429 && retryAfterMs == null) {
    try {
      const body = (await response.json()) as { retry_after?: unknown };
      const seconds = Number(body.retry_after);
      if (Number.isFinite(seconds) && seconds >= 0) {
        retryAfterMs = Math.min(
          DISCORD_MAX_RETRY_AFTER_MS,
          Math.ceil(seconds * 1_000),
        );
      }
    } catch {
      await cancelResponseBody(response);
    }
  } else {
    await cancelResponseBody(response);
  }

  if (retryAfterMs != null && retryAfterMs > 0) {
    setCooldown(routeKey, retryAfterMs);
  }`,
`  let retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    DISCORD_MAX_RETRY_AFTER_MS,
  );
  let globalLimit =
    response.headers.get("x-ratelimit-global") === "true" ||
    response.headers.get("x-ratelimit-scope") === "global";
  if (response.status === 429 && retryAfterMs == null) {
    try {
      const body = (await response.json()) as {
        retry_after?: unknown;
        global?: unknown;
      };
      globalLimit ||= body.global === true;
      const seconds = Number(body.retry_after);
      if (Number.isFinite(seconds) && seconds >= 0) {
        retryAfterMs = Math.min(
          DISCORD_MAX_RETRY_AFTER_MS,
          Math.ceil(seconds * 1_000),
        );
      }
    } catch {
      await cancelResponseBody(response);
    }
  } else {
    await cancelResponseBody(response);
  }

  if (retryAfterMs != null && retryAfterMs > 0) {
    setCooldown(globalLimit ? DISCORD_GLOBAL_COOLDOWN_KEY : routeKey, retryAfterMs);
  }`,
);

fs.writeFileSync(path, source);
fs.rmSync("scripts/agent-discord-global-cooldown.mjs");
fs.rmSync(".github/workflows/agent-discord-global-cooldown.yml");
console.log("Discord global cooldown applied");
