"use client";

// Estado compartilhado das pendências do painel (contador do topo, menu,
// título da aba, home). Vive no módulo para sobreviver à troca de página.
//
// Custo: o resumo vem de um cache de 60 s no backend, compartilhado por todos
// os admins. O painel só busca de novo quando o backend avisa que algo mudou
// (socket leve, modo "ops", sem os loops de métricas) ou a cada 5 min como
// rede de segurança, e nunca com a aba escondida.

import { io } from "socket.io-client";
import config from "@/src/config";
import { leafAPI } from "@/src/services/api";
import { authService } from "@/src/services/auth-service";

const FALLBACK_REFRESH_MS = 5 * 60 * 1000;
const CHANGE_DEBOUNCE_MS = 2000;
const NOTIFY_PREF_KEY = "leaf.dashboard.ops-notify";

// changeSeq sobe a cada aviso do backend: telas com lista própria recarregam por ele.
let state = { summary: null, loading: false, error: "", updatedAt: 0, changeSeq: 0 };
const listeners = new Set();
const increaseListeners = new Set();
let socket = null;
let fallbackTimer = null;
let changeTimer = null;
let subscribers = 0;
let staleWhileHidden = false;

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

function pageHidden() {
  return typeof document !== "undefined" && document.hidden;
}

export async function refreshOpsPending() {
  if (pageHidden()) {
    staleWhileHidden = true;
    return state.summary;
  }
  staleWhileHidden = false;
  const previous = state.summary;
  setState({ loading: true });
  try {
    const response = await leafAPI.getOpsPendingSummary();
    const summary = response?.summary || null;
    setState({ summary, loading: false, error: "", updatedAt: Date.now() });
    if (previous && summary && summary.drivers?.review > previous.drivers?.review) {
      increaseListeners.forEach((listener) => listener({ previous, summary }));
    }
    return summary;
  } catch (error) {
    setState({ loading: false, error: error?.message || "Pendências indisponíveis" });
    return null;
  }
}

function scheduleChangeRefresh() {
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    changeTimer = null;
    setState({ changeSeq: state.changeSeq + 1 });
    refreshOpsPending();
  }, CHANGE_DEBOUNCE_MS);
}

function onVisibilityChange() {
  if (!pageHidden() && staleWhileHidden) refreshOpsPending();
}

function connectSocket() {
  if (socket || typeof window === "undefined") return;
  const token = authService.getAccessToken();
  if (!token) return;
  socket = io(`${config.ws.baseUrl}/dashboard`, {
    auth: { jwtToken: token },
    transports: config.ws.transports || ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
  });
  socket.on("connect", () => {
    socket.emit("authenticate", { jwtToken: authService.getAccessToken() || token, mode: "ops" });
  });
  socket.on("ops:pending_changed", scheduleChangeRefresh);
}

function start() {
  connectSocket();
  if (!fallbackTimer) fallbackTimer = setInterval(refreshOpsPending, FALLBACK_REFRESH_MS);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
  if (!state.summary && !state.loading) refreshOpsPending();
}

function stop() {
  if (fallbackTimer) clearInterval(fallbackTimer);
  fallbackTimer = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  if (socket) socket.disconnect();
  socket = null;
}

export function subscribeOpsPending(listener) {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) start();
  listener(state);
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    // Espera a próxima página montar antes de derrubar a conexão.
    setTimeout(() => {
      if (subscribers === 0) stop();
    }, 1000);
  };
}

export function onOpsPendingIncrease(listener) {
  increaseListeners.add(listener);
  return () => increaseListeners.delete(listener);
}

export function getOpsPendingState() {
  return state;
}

export function readNotifyPreference() {
  try {
    return window.localStorage.getItem(NOTIFY_PREF_KEY) === "on";
  } catch (_) {
    return false;
  }
}

export function writeNotifyPreference(enabled) {
  try {
    window.localStorage.setItem(NOTIFY_PREF_KEY, enabled ? "on" : "off");
  } catch (_) {
    // Preferência só deste navegador.
  }
}

export function formatWaiting(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  const minutes = Math.floor(value / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} dias`;
}

export function waitingTone(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "muted";
  if (value >= 24 * 3600000) return "bad";
  if (value >= 2 * 3600000) return "warn";
  return "ok";
}
