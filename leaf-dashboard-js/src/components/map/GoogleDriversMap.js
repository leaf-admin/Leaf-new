"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { GoogleMap, MarkerClustererF, MarkerF, PolygonF, useJsApiLoader } from "@react-google-maps/api";

const MAP_STYLE = {
  width: "100%",
  height: "360px",
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

export default function GoogleDriversMap({
  drivers = [],
  h3Cells = [],
  h3Loading = false,
  h3Error = "",
  onViewportChange,
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const hasKey = Boolean(apiKey);
  const [mapMode, setMapMode] = useState("both");
  const [selectedCell, setSelectedCell] = useState(null);
  const mapRef = useRef(null);
  const lastViewportKeyRef = useRef("");

  const { isLoaded, loadError } = useJsApiLoader({
    id: "leaf-google-maps",
    googleMapsApiKey: apiKey,
  });

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

  const emitViewport = useCallback(() => {
    if (!mapRef.current || typeof onViewportChange !== "function") return;
    const bounds = mapRef.current.getBounds?.();
    const zoom = mapRef.current.getZoom?.();
    if (!bounds || !Number.isFinite(Number(zoom))) return;

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const bbox = [southWest.lng(), southWest.lat(), northEast.lng(), northEast.lat()].join(",");
    const viewportKey = `${bbox}:${zoom}`;
    if (viewportKey === lastViewportKeyRef.current) {
      return;
    }

    lastViewportKeyRef.current = viewportKey;
    onViewportChange({ bbox, zoom: Number(zoom) });
  }, [onViewportChange]);

  const handleMapLoad = useCallback(
    (map) => {
      mapRef.current = map;
      emitViewport();
    },
    [emitViewport],
  );

  if (!hasKey) {
    return <p>Google Maps API key não configurada (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).</p>;
  }

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
        {h3Loading ? <span style={{ fontSize: 12, color: "#475569" }}>Atualizando H3...</span> : null}
        {h3Error ? <span style={{ fontSize: 12, color: "#b91c1c" }}>{h3Error}</span> : null}
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
        mapContainerStyle={MAP_STYLE}
        center={center}
        zoom={12}
        onLoad={handleMapLoad}
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
