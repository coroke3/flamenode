/**
 * 動画プレイヤーと周辺 UI の軽量ブリッジ。
 *
 * - `seekToTime(time)`: 埋め込み iframe へ seek 命令を送る（iframe 自体は再読み込みしない）。
 */

const SEEK = "flamenode:seek";

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
