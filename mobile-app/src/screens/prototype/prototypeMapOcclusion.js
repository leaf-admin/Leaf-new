import { useEffect } from 'react';
import { useIsFocused, useNavigationState } from '@react-navigation/native';

const DEFAULT_OCCLUSION = Object.freeze({ top: 0, bottom: 0 });

let revision = 0;
const layers = new Map();
const listeners = new Set();

function toSafeNumber(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function resolveActiveLayer() {
  if (layers.size === 0) {
    return DEFAULT_OCCLUSION;
  }

  let active = null;
  layers.forEach(layer => {
    if (!active) {
      active = layer;
      return;
    }

    if (layer.priority > active.priority) {
      active = layer;
      return;
    }

    if (layer.priority === active.priority && layer.revision > active.revision) {
      active = layer;
    }
  });

  if (!active) {
    return DEFAULT_OCCLUSION;
  }

  return {
    top: active.top,
    bottom: active.bottom
  };
}

function notify() {
  const payload = resolveActiveLayer();
  listeners.forEach(listener => listener(payload));
}

export function setPrototypeMapOcclusionLayer(id, payload = {}) {
  if (!id) {
    return;
  }

  revision += 1;
  layers.set(id, {
    id,
    top: toSafeNumber(payload.top),
    bottom: toSafeNumber(payload.bottom),
    priority: Number.isFinite(payload.priority) ? payload.priority : 0,
    revision
  });
  notify();
}

export function clearPrototypeMapOcclusionLayer(id) {
  if (!id || !layers.has(id)) {
    return;
  }

  layers.delete(id);
  notify();
}

export function subscribePrototypeMapOcclusion(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  listeners.add(listener);
  listener(resolveActiveLayer());

  return () => {
    listeners.delete(listener);
  };
}

export function usePrototypeMapOcclusion({
  routeKey,
  layerId,
  occludedTop = 0,
  occludedBottom = 0
}) {
  const isFocused = useIsFocused();
  const routePriority = useNavigationState(state => state.routes.findIndex(item => item.key === routeKey));

  useEffect(() => {
    const id = layerId || routeKey;
    if (!id) {
      return undefined;
    }

    if (!isFocused) {
      clearPrototypeMapOcclusionLayer(id);
      return undefined;
    }

    setPrototypeMapOcclusionLayer(id, {
      top: occludedTop,
      bottom: occludedBottom,
      priority: routePriority
    });

    return () => {
      clearPrototypeMapOcclusionLayer(id);
    };
  }, [isFocused, layerId, occludedBottom, occludedTop, routeKey, routePriority]);
}

