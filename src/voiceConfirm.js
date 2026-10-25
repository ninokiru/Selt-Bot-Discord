let state = {
  active: false,
  expiresAt: 0,
  timeout: null,
  channelId: null,   // channel hiện tại lúc bắt đầu confirm
};

const DEFAULT_TTL_MS = 30000;

export function startConfirm(channelId, ttlMs = DEFAULT_TTL_MS) {
  cancel();
  state.active = true;
  state.expiresAt = Date.now() + ttlMs;
  state.channelId = channelId || null;

  state.timeout = setTimeout(() => {
    state.active = false;
    state.expiresAt = 0;
    state.channelId = null;
    state.timeout = null;
  }, ttlMs);

  if (state.timeout.unref) state.timeout.unref();
}

export function cancel() {
  if (state.timeout) {
    clearTimeout(state.timeout);
  }
  state.active = false;
  state.expiresAt = 0;
  state.channelId = null;
  state.timeout = null;
}

export function isPending() {
  return state.active && Date.now() < state.expiresAt;
}

export function getRemaining() {
  return Math.max(0, state.expiresAt - Date.now());
}

export function getPendingChannel() {
  return state.channelId;
}