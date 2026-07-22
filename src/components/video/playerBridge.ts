/**
 * 動画プレイヤーと周辺 UI の軽量ブリッジ。
 *
 * - `seekToTime(time)`: 埋め込み iframe へ seek 命令を送る（iframe 自体は再読み込みしない）。
 * - `publishPlayerTime(seconds)`: 現在の再生位置を CustomEvent で配信する。
 */

const SEEK = "flamenode:seek";
export const PLAYER_TIME = "flamenode:player-time";

export const YOUTUBE_PLAYER_ORIGIN = "https://www.youtube.com";

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
    JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
    targetOrigin,
  );
}

export function requestYoutubeCurrentTime(
  iframe: HTMLIFrameElement,
  targetOrigin = YOUTUBE_PLAYER_ORIGIN,
): void {
  postYoutubePlayerCommand(iframe, "getCurrentTime", [], targetOrigin);
}

export function parseYoutubePlayerMessage(
  data: unknown,
):
  | { kind: "ready" }
  | { kind: "time"; currentTime: number }
  | null {
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
    info?: { currentTime?: number };
  };

  if (message.event === "onReady") {
    return { kind: "ready" };
  }

  if (
    message.event === "infoDelivery" &&
    typeof message.info?.currentTime === "number" &&
    Number.isFinite(message.info.currentTime)
  ) {
    return { kind: "time", currentTime: message.info.currentTime };
  }

  return null;
}

export function isYoutubePlayerMessageOrigin(origin: string): boolean {
  return (
    origin === YOUTUBE_PLAYER_ORIGIN ||
    origin === "https://www.youtube-nocookie.com"
  );
}
