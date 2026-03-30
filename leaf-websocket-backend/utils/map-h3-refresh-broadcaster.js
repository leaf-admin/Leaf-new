const DEFAULT_COOLDOWN_MS = Math.max(
  500,
  Number.parseInt(process.env.APP_H3_REFRESH_COOLDOWN_MS || '900', 10)
);

const broadcasterState = new WeakMap();

function getState(io) {
  if (!broadcasterState.has(io)) {
    broadcasterState.set(io, {
      lastEmitAt: 0,
      timerId: null,
      pendingPayload: null
    });
  }

  return broadcasterState.get(io);
}

function buildPayload(payload = {}) {
  return {
    scope: 'viewport',
    surfaces: ['driver'],
    timestamp: new Date().toISOString(),
    ...payload
  };
}

function emitNow(io, state, payload = {}) {
  state.lastEmitAt = Date.now();
  io.emit('map_h3_refresh', buildPayload(payload));
}

function scheduleMapH3Refresh(io, payload = {}) {
  if (!io || typeof io.emit !== 'function') {
    return;
  }

  const state = getState(io);
  state.pendingPayload = {
    ...(state.pendingPayload || {}),
    ...payload
  };

  const remainingMs = Math.max(0, DEFAULT_COOLDOWN_MS - (Date.now() - state.lastEmitAt));

  if (remainingMs === 0 && !state.timerId) {
    const nextPayload = state.pendingPayload;
    state.pendingPayload = null;
    emitNow(io, state, nextPayload);
    return;
  }

  if (state.timerId) {
    return;
  }

  state.timerId = setTimeout(() => {
    state.timerId = null;
    const nextPayload = state.pendingPayload;
    state.pendingPayload = null;
    emitNow(io, state, nextPayload);
  }, remainingMs || DEFAULT_COOLDOWN_MS);
}

module.exports = {
  scheduleMapH3Refresh
};
