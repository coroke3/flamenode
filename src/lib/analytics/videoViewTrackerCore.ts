export const VIEW_THRESHOLD_SECONDS = 10;
export const VIEW_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type ViewTrackerStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type VideoViewTrackerState = {
  videoId: string;
  accumulatedSeconds: number;
  prevSeconds: number | null;
  sentInMount: boolean;
  thresholdEvaluated: boolean;
};

export type PlayerTimeTickInput = {
  seconds: number;
  nowMs: number;
  visibilityState: DocumentVisibilityState;
  videoId: string;
  storage: ViewTrackerStorage;
};

export function getViewStorageKey(videoId: string): string {
  return `fn:ga-view:${videoId}`;
}

export function createVideoViewTrackerState(
  videoId: string,
): VideoViewTrackerState {
  return {
    videoId,
    accumulatedSeconds: 0,
    prevSeconds: null,
    sentInMount: false,
    thresholdEvaluated: false,
  };
}

export function canSendByStorage(
  videoId: string,
  nowMs: number,
  storage: ViewTrackerStorage,
): boolean {
  try {
    const raw = storage.getItem(getViewStorageKey(videoId));
    if (!raw) return true;
    const nextSendableMs = Number(raw);
    if (!Number.isFinite(nextSendableMs)) return true;
    return nowMs >= nextSendableMs;
  } catch {
    return true;
  }
}

export function onPlayerTimeTick(
  state: VideoViewTrackerState,
  input: PlayerTimeTickInput,
): { state: VideoViewTrackerState; shouldSend: boolean } {
  let nextState =
    input.videoId !== state.videoId
      ? createVideoViewTrackerState(input.videoId)
      : state;

  if (nextState.sentInMount || nextState.thresholdEvaluated) {
    return { state: nextState, shouldSend: false };
  }

  if (input.visibilityState !== "visible") {
    return { state: { ...nextState, prevSeconds: null }, shouldSend: false };
  }

  if (nextState.prevSeconds === null) {
    return {
      state: { ...nextState, prevSeconds: input.seconds },
      shouldSend: false,
    };
  }

  const delta = input.seconds - nextState.prevSeconds;
  let accumulated = nextState.accumulatedSeconds;
  if (delta >= 0.1 && delta <= 1.5) {
    accumulated += delta;
  }

  nextState = {
    ...nextState,
    prevSeconds: input.seconds,
    accumulatedSeconds: accumulated,
  };

  if (accumulated < VIEW_THRESHOLD_SECONDS) {
    return { state: nextState, shouldSend: false };
  }

  const shouldSend = canSendByStorage(
    nextState.videoId,
    input.nowMs,
    input.storage,
  );

  return {
    state: { ...nextState, thresholdEvaluated: true },
    shouldSend,
  };
}

export function markSent(
  state: VideoViewTrackerState,
  nowMs: number,
  storage: ViewTrackerStorage,
): VideoViewTrackerState {
  try {
    storage.setItem(
      getViewStorageKey(state.videoId),
      String(nowMs + VIEW_COOLDOWN_MS),
    );
  } catch {
    // localStorage 例外でもクラッシュしない
  }
  return { ...state, sentInMount: true };
}
