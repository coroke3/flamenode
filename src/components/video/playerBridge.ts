/**
 * 動画プレイヤーと周辺 UI の軽量ブリッジ。
 *
 * - `seekToTime(time)`: 埋め込み iframe を指定秒から再生し直す。
 * - `requestCurrentTime()`: 単純埋め込みでは再生位置を取得できないため常に 0。
 */

const SEEK = "flamenode:seek";
const REQUEST = "flamenode:request-time";
const RESPONSE = "flamenode:current-time";

export function seekToTime(time: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SEEK, {
      detail: { time: Math.max(0, Math.floor(time)) },
    }),
  );
}

export function requestCurrentTime(timeoutMs = 500): Promise<number> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(0);
    let done = false;
    const onResponse = (ev: Event) => {
      if (done) return;
      done = true;
      window.removeEventListener(RESPONSE, onResponse as EventListener);
      const time = (ev as CustomEvent<{ time?: number }>).detail?.time ?? 0;
      resolve(Math.max(0, Math.floor(time * 1000) / 1000));
    };
    window.addEventListener(RESPONSE, onResponse as EventListener);
    window.dispatchEvent(new CustomEvent(REQUEST));
    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener(RESPONSE, onResponse as EventListener);
      resolve(0);
    }, timeoutMs);
  });
}
