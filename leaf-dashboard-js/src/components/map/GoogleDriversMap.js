"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, MarkerClustererF, MarkerF, PolygonF, useJsApiLoader } from "@react-google-maps/api";

const BASE_MAP_STYLE = {
  width: "100%",
  height: "520px",
  borderRadius: "10px",
};

function getCenter(drivers = [], h3Cells = []) {
  if (drivers.length) {
    const acc = drivers.reduce(
      (sum, point) => ({
        lat: sum.lat + Number(point.location.lat),
        lng: sum.lng + Number(point.location.lng),
      }),
      { lat: 0, lng: 0 },
    );
    return {
      lat: acc.lat / drivers.length,
      lng: acc.lng / drivers.length,
    };
  }

  if (h3Cells.length) {
    const acc = h3Cells.reduce(
      (sum, cell) => ({
        lat: sum.lat + Number(cell?.center?.lat || 0),
        lng: sum.lng + Number(cell?.center?.lng || 0),
      }),
      { lat: 0, lng: 0 },
    );
    return {
      lat: acc.lat / h3Cells.length,
      lng: acc.lng / h3Cells.length,
    };
  }

  return { lat: -22.9068, lng: -43.1729 };
}

function normalizeGeofenceRegion(region = []) {
  if (!Array.isArray(region)) return [];

  const normalized = [];
  for (const point of region) {
    let lng = null;
    let lat = null;

    if (Array.isArray(point) && point.length >= 2) {
      lng = Number(point[0]);
      lat = Number(point[1]);
    } else if (point && typeof point === "object") {
      lng = Number(point.lng);
      lat = Number(point.lat);
    } else {
      continue;
    }

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      continue;
    }

    normalized.push([lng, lat]);
  }

  if (normalized.length < 3) return [];
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    normalized.push([first[0], first[1]]);
  }
  return normalized;
}

function getGeofencePointCount(region = []) {
  if (!Array.isArray(region) || region.length === 0) return 0;
  if (region.length < 2) return region.length;
  const first = region[0];
  const last = region[region.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  return isClosed ? Math.max(region.length - 1, 0) : region.length;
}

function extractRegionFromPath(path) {
  if (!path || typeof path.getLength !== "function" || typeof path.getAt !== "function") {
    return [];
  }

  const region = [];
  for (let index = 0; index < path.getLength(); index += 1) {
    const point = path.getAt(index);
    const lng = Number(point?.lng?.());
    const lat = Number(point?.lat?.());
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    region.push([lng, lat]);
  }

  if (region.length < 3) return [];
  const first = region[0];
  const last = region[region.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    region.push([first[0], first[1]]);
  }
  return region;
}

function pathsEqual(current = [], next = []) {
  if (current.length !== next.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    const a = current[index];
    const b = next[index];
    if (Math.abs(Number(a.lat) - Number(b.lat)) > 1e-9) return false;
    if (Math.abs(Number(a.lng) - Number(b.lng)) > 1e-9) return false;
  }
  return true;
}

export default function GoogleDriversMap({
  drivers = [],
  h3Cells = [],
  h3Loading = false,
  h3Error = "",
  h3LastUpdatedAt = null,
  onViewportChange,
  mapHeight = "520px",
  geofenceRegion = [],
  geofenceEditable = false,
  onGeofenceChange,
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const hasKey = Boolean(apiKey);

  if (!hasKey) {
    return <p>Google Maps API key não configurada (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).</p>;
  }

  return (
    <GoogleDriversMapWithKey
      apiKey={apiKey}
      drivers={drivers}
      h3Cells={h3Cells}
      h3Loading={h3Loading}
      h3Error={h3Error}
      h3LastUpdatedAt={h3LastUpdatedAt}
      onViewportChange={onViewportChange}
      mapHeight={mapHeight}
      geofenceRegion={geofenceRegion}
      geofenceEditable={geofenceEditable}
      onGeofenceChange={onGeofenceChange}
    />
  );
}

function GoogleDriversMapWithKey({
  apiKey,
  drivers = [],
  h3Cells = [],
  h3Loading = false,
  h3Error = "",
  h3LastUpdatedAt = null,
  onViewportChange,
  mapHeight = "520px",
  geofenceRegion = [],
  geofenceEditable = false,
  onGeofenceChange,
}) {
  const [mapMode, setMapMode] = useState("both");
  const [selectedCell, setSelectedCell] = useState(null);
  const [isDrawingGeofence, setIsDrawingGeofence] = useState(false);
  const [drawingRegionDraft, setDrawingRegionDraft] = useState([]);
  const mapRef = useRef(null);
  const lastViewportKeyRef = useRef("");
  const editableGeofenceRef = useRef(null);
  const geofencePathListenersRef = useRef([]);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "leaf-google-maps",
    googleMapsApiKey: apiKey,
  });

  const mapContainerStyle = useMemo(
    () => ({
      ...BASE_MAP_STYLE,
      height: mapHeight || BASE_MAP_STYLE.height,
    }),
    [mapHeight],
  );

  const normalizedGeofenceRegion = useMemo(() => normalizeGeofenceRegion(geofenceRegion), [geofenceRegion]);
  const geofencePaths = useMemo(
    () => normalizedGeofenceRegion.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) })),
    [normalizedGeofenceRegion],
  );
  const geofencePointCount = useMemo(
    () => getGeofencePointCount(normalizedGeofenceRegion),
    [normalizedGeofenceRegion],
  );
  const h3LastSyncLabel = useMemo(() => {
    if (!h3LastUpdatedAt) return null;
    const date = new Date(h3LastUpdatedAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString("pt-BR", { hour12: false });
  }, [h3LastUpdatedAt]);

  const validDrivers = useMemo(
    () =>
      drivers.filter(
        (driver) =>
          driver?.location &&
          Number.isFinite(Number(driver.location.lat)) &&
          Number.isFinite(Number(driver.location.lng)),
      ),
    [drivers],
  );

  const validCells = useMemo(
    () =>
      h3Cells.filter(
        (cell) =>
          Array.isArray(cell?.boundary) &&
          cell.boundary.length >= 6 &&
          Number.isFinite(Number(cell?.center?.lat)) &&
          Number.isFinite(Number(cell?.center?.lng)),
      ),
    [h3Cells],
  );

  const center = useMemo(() => getCenter(validDrivers, validCells), [validDrivers, validCells]);
  const drawingEnabled = geofenceEditable && isDrawingGeofence;
  const drawingRegionPaths = useMemo(
    () => normalizeGeofenceRegion(drawingRegionDraft).map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) })),
    [drawingRegionDraft],
  );

  const clearGeofencePathListeners = useCallback(() => {
    geofencePathListenersRef.current.forEach((listener) => {
      if (listener && typeof listener.remove === "function") {
        listener.remove();
      }
    });
    geofencePathListenersRef.current = [];
  }, []);

  const emitGeofenceChange = useCallback(
    (path) => {
      if (typeof onGeofenceChange !== "function") return;
      const nextRegion = extractRegionFromPath(path);
      onGeofenceChange(nextRegion);
    },
    [onGeofenceChange],
  );

  const emitViewport = useCallback(() => {
    if (!mapRef.current || typeof onViewportChange !== "function") return;
    const bounds = mapRef.current.getBounds?.();
    const zoom = mapRef.current.getZoom?.();
    if (!bounds || !Number.isFinite(Number(zoom))) return;

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const bbox = [southWest.lng(), southWest.lat(), northEast.lng(), northEast.lat()]
      .map((coord) => Number(coord).toFixed(5))
      .join(",");
    const normalizedZoom = Number(Number(zoom).toFixed(2));
    const viewportKey = `${bbox}:${normalizedZoom}`;
    if (viewportKey === lastViewportKeyRef.current) {
      return;
    }

    lastViewportKeyRef.current = viewportKey;
    onViewportChange({ bbox, zoom: normalizedZoom });
  }, [onViewportChange]);

  const handleMapLoad = useCallback(
    (map) => {
      mapRef.current = map;
      emitViewport();
    },
    [emitViewport],
  );

  const handleGeofencePolygonLoad = useCallback(
    (polygon) => {
      editableGeofenceRef.current = polygon;
      clearGeofencePathListeners();

      if (!geofenceEditable) return;
      const path = polygon.getPath();
      if (!path) return;

      const syncPath = () => emitGeofenceChange(path);
      geofencePathListenersRef.current = [
        path.addListener("set_at", syncPath),
        path.addListener("insert_at", syncPath),
        path.addListener("remove_at", syncPath),
      ];
    },
    [clearGeofencePathListeners, emitGeofenceChange, geofenceEditable],
  );

  const handleGeofencePolygonUnmount = useCallback(() => {
    clearGeofencePathListeners();
    editableGeofenceRef.current = null;
  }, [clearGeofencePathListeners]);

  useEffect(() => {
    const polygon = editableGeofenceRef.current;
    if (!polygon) return;

    const currentPath = polygon.getPath();
    const currentPoints = [];
    for (let index = 0; index < currentPath.getLength(); index += 1) {
      const point = currentPath.getAt(index);
      currentPoints.push({
        lat: Number(point?.lat?.()),
        lng: Number(point?.lng?.()),
      });
    }

    if (pathsEqual(currentPoints, geofencePaths)) {
      return;
    }
    polygon.setPath(geofencePaths);
  }, [geofencePaths]);

  useEffect(
    () => () => {
      clearGeofencePathListeners();
    },
    [clearGeofencePathListeners],
  );

  const startDrawingGeofence = useCallback(() => {
    if (!geofenceEditable) return;
    setDrawingRegionDraft([]);
    setIsDrawingGeofence(true);
  }, [geofenceEditable]);

  const cancelDrawingGeofence = useCallback(() => {
    setDrawingRegionDraft([]);
    setIsDrawingGeofence(false);
  }, []);

  const clearGeofence = useCallback(() => {
    setDrawingRegionDraft([]);
    setIsDrawingGeofence(false);
    if (typeof onGeofenceChange !== "function") return;
    onGeofenceChange([]);
  }, [onGeofenceChange]);

  const handleMapClick = useCallback(
    (event) => {
      if (!drawingEnabled) return;
      const lat = Number(event?.latLng?.lat?.());
      const lng = Number(event?.latLng?.lng?.());
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setDrawingRegionDraft((current) => [...current, [lng, lat]]);
    },
    [drawingEnabled],
  );

  const undoDrawingPoint = useCallback(() => {
    setDrawingRegionDraft((current) => current.slice(0, -1));
  }, []);

  const completeDrawingGeofence = useCallback(() => {
    if (!drawingEnabled) return;
    if (typeof onGeofenceChange !== "function") return;
    const normalized = normalizeGeofenceRegion(drawingRegionDraft);
    if (normalized.length < 4) return;
    onGeofenceChange(normalized);
    setDrawingRegionDraft([]);
    setIsDrawingGeofence(false);
  }, [drawingEnabled, drawingRegionDraft, onGeofenceChange]);

  if (loadError) {
    return <p>Falha ao carregar Google Maps.</p>;
  }

  if (!isLoaded) {
    return <p>Carregando Google Maps...</p>;
  }

  return (
    <div className="google-map-wrap">
      <div className="google-map-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          type="button"
          className={mapMode === "drivers" ? "mode-btn mode-btn-active" : "mode-btn"}
          onClick={() => setMapMode("drivers")}
        >
          Motoristas
        </button>
        <button
          type="button"
          className={mapMode === "hex" ? "mode-btn mode-btn-active" : "mode-btn"}
          onClick={() => setMapMode("hex")}
        >
          Hex de oferta/demanda
        </button>
        <button
          type="button"
          className={mapMode === "both" ? "mode-btn mode-btn-active" : "mode-btn"}
          onClick={() => setMapMode("both")}
        >
          Ambos
        </button>
        {h3Loading && validCells.length === 0 ? (
          <span style={{ fontSize: 12, color: "#475569" }}>Carregando H3...</span>
        ) : null}
        {h3LastSyncLabel ? <span style={{ fontSize: 12, color: "#475569" }}>H3 atualizado: {h3LastSyncLabel}</span> : null}
        {h3Error ? <span style={{ fontSize: 12, color: "#b91c1c" }}>{h3Error}</span> : null}
        {geofenceEditable ? (
          <>
            <button
              type="button"
              className={drawingEnabled ? "mode-btn mode-btn-active" : "mode-btn"}
              onClick={startDrawingGeofence}
            >
              Traçar geofence
            </button>
            {drawingEnabled ? (
              <button
                type="button"
                className="mode-btn"
                onClick={completeDrawingGeofence}
                disabled={drawingRegionPaths.length < 4}
              >
                Concluir traçado
              </button>
            ) : null}
            {drawingEnabled ? (
              <button type="button" className="mode-btn" onClick={undoDrawingPoint} disabled={drawingRegionDraft.length === 0}>
                Desfazer ponto
              </button>
            ) : null}
            {drawingEnabled ? (
              <button type="button" className="mode-btn" onClick={cancelDrawingGeofence}>
                Cancelar traçado
              </button>
            ) : null}
            <button type="button" className="mode-btn" onClick={clearGeofence} disabled={geofencePointCount === 0}>
              Limpar geofence
            </button>
            <span style={{ fontSize: 12, color: "#475569" }}>
              Geofence:{" "}
              {drawingEnabled
                ? `${drawingRegionDraft.length} ponto${drawingRegionDraft.length === 1 ? "" : "s"} no rascunho`
                : geofencePointCount > 0
                  ? `${geofencePointCount} pontos`
                  : "sem polígono"}
            </span>
          </>
        ) : null}
      </div>

      {selectedCell ? (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 12,
            padding: "12px 14px",
            border: "1px solid rgba(15,23,42,0.08)",
            background: "rgba(248,250,252,0.92)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <strong style={{ display: "block", marginBottom: 4 }}>Cell H3 {selectedCell.h3Index}</strong>
              <span style={{ fontSize: 13, color: "#475569" }}>
                Oferta {selectedCell.metrics.supply} • Disponíveis {selectedCell.metrics.availableDrivers} • Demanda {selectedCell.metrics.demand}
              </span>
            </div>
            <span style={{ fontSize: 12, color: "#334155", textTransform: "capitalize" }}>
              {selectedCell.metrics.fillRateHint}
            </span>
          </div>
        </div>
      ) : null}

      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        defaultCenter={center}
        zoom={12}
        onLoad={handleMapLoad}
        onClick={handleMapClick}
        onIdle={emitViewport}
        options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
      >
        {(mapMode === "hex" || mapMode === "both") &&
          validCells.map((cell) => (
            <PolygonF
              key={cell.h3Index}
              paths={cell.boundary.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))}
              options={{
                clickable: true,
                fillColor: cell.style?.fill || "#22C55E",
                fillOpacity: Number(cell.style?.fillOpacity ?? 0.18),
                strokeColor: cell.style?.stroke || "#15803D",
                strokeOpacity: Number(cell.style?.strokeOpacity ?? 0.58),
                strokeWeight: Number(cell.style?.strokeWidth ?? 1),
                zIndex: 2,
              }}
              onClick={() => setSelectedCell(cell)}
            />
          ))}

        {normalizedGeofenceRegion.length >= 4 ? (
          <PolygonF
            paths={geofencePaths}
            options={{
              clickable: false,
              fillColor: "#16a34a",
              fillOpacity: 0.14,
              strokeColor: "#16a34a",
              strokeOpacity: 0.92,
              strokeWeight: 3,
              editable: geofenceEditable && !drawingEnabled,
              draggable: geofenceEditable && !drawingEnabled,
              zIndex: 4,
            }}
            onLoad={handleGeofencePolygonLoad}
            onUnmount={handleGeofencePolygonUnmount}
          />
        ) : null}

        {drawingEnabled && drawingRegionPaths.length >= 4 ? (
          <PolygonF
            paths={drawingRegionPaths}
            options={{
              clickable: false,
              fillColor: "#22c55e",
              fillOpacity: 0.1,
              strokeColor: "#15803d",
              strokeOpacity: 0.9,
              strokeWeight: 2,
              zIndex: 5,
            }}
          />
        ) : null}

        {drawingEnabled
          ? drawingRegionDraft.map(([lng, lat], pointIndex) => (
              <MarkerF
                key={`draft-point-${pointIndex}`}
                position={{ lat: Number(lat), lng: Number(lng) }}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: 4,
                  fillColor: "#14532d",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 1,
                }}
                zIndex={6}
              />
            ))
          : null}

        {(mapMode === "drivers" || mapMode === "both") && validDrivers.length ? (
          <MarkerClustererF options={{ maxZoom: 16, minimumClusterSize: 2 }}>
            {(clusterer) =>
              validDrivers.map((driver, idx) => (
                <MarkerF
                  key={driver.id || idx}
                  clusterer={clusterer}
                  position={{
                    lat: Number(driver.location.lat),
                    lng: Number(driver.location.lng),
                  }}
                  icon={{
                    path: window.google.maps.SymbolPath.CIRCLE,
                    scale: 7,
                    fillColor: "#2563eb",
                    fillOpacity: 0.95,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                  }}
                  label={{
                    text: String(idx + 1),
                    color: "#0f172a",
                    fontWeight: "700",
                    fontSize: "11px",
                  }}
                  title={`${driver.id || "driver"} • ${driver.status || "unknown"}`}
                />
              ))
            }
          </MarkerClustererF>
        ) : null}
      </GoogleMap>
    </div>
  );
}
