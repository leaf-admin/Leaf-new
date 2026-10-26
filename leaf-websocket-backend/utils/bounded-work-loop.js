'use strict';

// Replaces an existing async interval; never overlaps or builds a timer backlog.
module.exports = function startBoundedWorkLoop({ run, idleMs, busyMs = 250, productive = () => false, onError = () => {} }) {
  const idle = Math.max(250, Number(idleMs) || 10000);
  const busy = Math.max(250, Number(busyMs) || 250);
  let stopped = false; let timer;
  const schedule = delay => {
    if (stopped) return;
    timer = setTimeout(tick, delay); timer?.unref?.();
  };
  const tick = async () => {
    let delay = idle;
    try { const result = await run(); if (productive(result)) delay = busy; }
    catch (error) { try { onError(error); } catch (_) { /* reporting cannot kill the existing loop */ } }
    finally { schedule(delay); }
  };
  schedule(idle);
  return { stop() { stopped = true; clearTimeout(timer); } };
};
