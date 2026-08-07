/**
 * 動画プレイヤーと周辺 UI の軽量ブリッジ。
 *
 * - `seekToTime(time)`: 埋め込み iframe へ seek 命令を送る（iframe 自体は再読み込みしない）。
 * - `publishPlayerTime(seconds)`: 現在の再生位置を CustomEvent で配信する。
 * - `publishPlayerEnded(...)`: 再生終了を CustomEvent で配信する。
 */

const SEEK = "flamenode:seek";
export const PLAYER_TIME = "flamenode:player-time";
export const PLAYER_ENDED = "flamenode:video-ended";

/** YouTube IFrame API: YT.PlayerState.ENDED */
export const YOUTUBE_PLAYER_STATE_ENDED = 0;

export const YOUTUBE_PLAYER_ORIGIN = "https://www.youtube.com";
export const YOUTUBE_PLAYER_IFRAME_ID = "flamenode-youtube-player";

export type YoutubePlayerParsedMessage =
  | { kind: "ready" }
  | { kind: "time"; currentTime: number }
  | { kind: "ended" }
  | { kind: "state"; playerState: number; currentTime?: number };

export function getYoutubePlayerListeningId(iframe: HTMLIFrameElement): string {
  return iframe.id || YOUTUBE_PLAYER_IFRAME_ID;
}

export function buildYoutubePlayerCommand(
  func: string,
  args: readonly unknown[] = [],
): string {
  return JSON.stringify({
    event: "command",
    func,
    args,
  });
}

export function postYoutubePlayerCommand(
  iframe: HTMLIFrameElement,
  func: string,
  args: readonly unknown[] = [],
  targetOrigin = "https://www.youtube.com",
): void {
  iframe.contentWindow?.postMessage(
    buildYoutubePlayerCommand(func, args),
    targetOrigin,
  );
}

export function seekYoutubeIframe(
  iframe: HTMLIFrameElement,
  time: number,
  targetOrigin = "https://www.youtube.com",
): void {
  const seconds = Math.max(0, Math.floor(time));
  postYoutubePlayerCommand(iframe, "seekTo", [seconds, true], targetOrigin);
}

export function seekToTime(time: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SEEK, {
      detail: { time: Math.max(0, Math.floor(time)) },
    }),
  );
}

export function publishPlayerTime(seconds: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(seconds)) return;
  window.dispatchEvent(
    new CustomEvent(PLAYER_TIME, {
      detail: { time: Math.max(0, seconds) },
    }),
  );
}

export function publishPlayerEnded(detail?: { youtubeId?: string }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PLAYER_ENDED, {
      detail: detail ?? {},
    }),
  );
}

export function subscribePlayerTime(
  callback: (seconds: number) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const time = (event as CustomEvent<{ time?: number }>).detail?.time;
    if (typeof time === "number" && Number.isFinite(time)) {
      callback(time);
    }
  };

  window.addEventListener(PLAYER_TIME, handler as EventListener);
  return () =>
    window.removeEventListener(PLAYER_TIME, handler as EventListener);
}

export function startYoutubePlayerListening(
  iframe: HTMLIFrameElement,
  targetOrigin = YOUTUBE_PLAYER_ORIGIN,
): void {
  iframe.contentWindow?.postMessage(
    JSON.stringify({
      event: "listening",
      id: getYoutubePlayerListeningId(iframe),
      channel: "widget",
    }),
    targetOrigin,
  );
  postYoutubePlayerCommand(iframe, "addEventListener", ["onStateChange"], targetOrigin);
}

export function requestYoutubeCurrentTime(
  iframe: HTMLIFrameElement,
  targetOrigin = YOUTUBE_PLAYER_ORIGIN,
): void {
  postYoutubePlayerCommand(iframe, "getCurrentTime", [], targetOrigin);
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readPlayerState(info: unknown): number | undefined {
  if (typeof info === "number" && Number.isFinite(info)) return info;
  if (!info || typeof info !== "object") return undefined;
  const row = info as { playerState?: unknown; state?: unknown };
  return readFiniteNumber(row.playerState) ?? readFiniteNumber(row.state);
}

export function parseYoutubePlayerMessage(
  data: unknown,
): YoutubePlayerParsedMessage | null {
  let parsed: unknown = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const message = parsed as {
    event?: string;
    info?: unknown;
  };

  if (message.event === "onReady") {
    return { kind: "ready" };
  }

  if (message.event === "onStateChange") {
    const playerState = readPlayerState(message.info);
    if (playerState === undefined) return null;
    if (playerState === YOUTUBE_PLAYER_STATE_ENDED) {
      return { kind: "ended" };
    }
    return { kind: "state", playerState };
  }

  if (message.event === "infoDelivery") {
    const info =
      message.info && typeof message.info === "object"
        ? (message.info as { currentTime?: unknown; playerState?: unknown })
        : null;
    const currentTime = readFiniteNumber(info?.currentTime);
    const playerState = readPlayerState(message.info);

    if (playerState === YOUTUBE_PLAYER_STATE_ENDED) {
      return currentTime !== undefined
        ? { kind: "state", playerState, currentTime }
        : { kind: "ended" };
    }

    if (currentTime !== undefined) {
      return playerState === undefined
        ? { kind: "time", currentTime }
        : { kind: "state", playerState, currentTime };
    }

    if (playerState !== undefined) {
      return { kind: "state", playerState };
    }
  }

  return null;
}

export function isYoutubePlayerMessageOrigin(origin: string): boolean {
  return (
    origin === YOUTUBE_PLAYER_ORIGIN ||
    origin === "https://www.youtube-nocookie.com"
  );
}
