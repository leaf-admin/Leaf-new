"use client";

import { useEffect, useMemo } from "react";

const VIEWBOX = { width: 920, height: 520 };
const DEFAULT_BOUNDS = {
  minLat: -23.08,
  maxLat: -22.84,
  minLng: -43.42,
  maxLng: -43.08,
};

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDriver(driver) {
  const lat = finiteNumber(driver?.location?.lat ?? driver?.latitude ?? driver?.lat);
  const lng = finiteNumber(driver?.location?.lng ?? driver?.longitude ?? driver?.lng);
  if (lat === null || lng === null) return null;
  return {
    id: driver?.id || driver?.driverId || `${lat}:${lng}`,
    name: driver?.name || driver?.driverName || "Motorista",
    status: String(driver?.status || driver?.availability || "unknown").toLowerCase(),
    lat,
    lng,
  };
}

function normalizeLngLat(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const lng = finiteNumber(point[0]);
    const lat = finiteNumber(point[1]);
    return lat === null || lng === null ? null : { lat, lng };
  }
  if (point && typeof point === "object") {
    const lat = finiteNumber(point.lat);
    const lng = finiteNumber(point.lng);
    return lat === null || lng === null ? null : { lat, lng };
  }
  return null;
}

function normalizeGeofenceRings(region) {
  if (!Array.isArray(region) || region.length === 0) return [];
  const flatRing = region.map(normalizeLngLat).filter(Boolean);
  if (flatRing.length === region.length && flatRing.length >= 3) return [flatRing];
  return region
    .map((ring) => (Array.isArray(ring) ? ring.map(normalizeLngLat).filter(Boolean) : []))
    .filter((ring) => ring.length >= 3);
}

function normalizeBoundaryPoint(point) {
  if (!Array.isArray(point)) return normalizeLngLat(point);
  const first = finiteNumber(point[0]);
  const second = finiteNumber(point[1]);
  if (first === null || second === null) return null;
  if (Math.abs(first) > 90) return { lng: first, lat: second };
  if (Math.abs(second) > 90) return { lat: first, lng: second };
  if (Math.abs(first) > 30 && Math.abs(second) < 30) return { lng: first, lat: second };
  return { lat: first, lng: second };
}

function normalizeCell(cell) {
  const boundary = Array.isArray(cell?.boundary)
    ? cell.boundary.map(normalizeBoundaryPoint).filter(Boolean)
    : [];
  if (boundary.length < 3) return null;
  return {
    id: cell?.h3Index || cell?.id || boundary.map((point) => `${point.lat}:${point.lng}`).join("|"),
    boundary,
    style: cell?.style || {},
    metrics: cell?.metrics || {},
  };
}

function samePoint(a, b) {
  return Boolean(a && b && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9);
}

function sampleRing(points, maximumPoints = 420) {
  if (points.length <= maximumPoints) return points;
  const stride = Math.ceil(points.length / maximumPoints);
  const sampled = points.filter((_, index) => index % stride === 0);
  const last = points[points.length - 1];
  if (!samePoint(sampled[sampled.length - 1], last)) sampled.push(last);
  return sampled;
}

function openPolygon(points) {
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) return points.slice(0, -1);
  return points;
}

function closePolygon(points) {
  if (points.length < 3) return points;
  return [...points, { ...points[0] }];
}

function buildBounds({ drivers, geofence }) {
  const points = [...drivers, ...geofence];
  if (!points.length) return DEFAULT_BOUNDS;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const latPad = Math.max(latSpan * 0.16, 0.012);
  const lngPad = Math.max(lngSpan * 0.16, 0.012);
  return {
    minLat: Math.min(...lats) - latPad,
    maxLat: Math.max(...lats) + latPad,
    minLng: Math.min(...lngs) - lngPad,
    maxLng: Math.max(...lngs) + lngPad,
  };
}

function approximateZoom(bounds) {
  const span = Math.max(bounds.maxLng - bounds.minLng, bounds.maxLat - bounds.minLat);
  if (span <= 0.03) return 14;
  if (span <= 0.07) return 13;
  if (span <= 0.15) return 12;
  if (span <= 0.3) return 11;
  if (span <= 0.6) return 10;
  if (span <= 1.2) return 9;
  return 8;
}

function project(point, bounds) {
  const lngRange = Math.max(bounds.maxLng - bounds.minLng, 0.0001);
  const latRange = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  return {
    x: ((point.lng - bounds.minLng) / lngRange) * VIEWBOX.width,
    y: VIEWBOX.height - ((point.lat - bounds.minLat) / latRange) * VIEWBOX.height,
  };
}

function unproject(point, bounds) {
  const lngRange = Math.max(bounds.maxLng - bounds.minLng, 0.0001);
  const latRange = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  return {
    lng: bounds.minLng + (point.x / VIEWBOX.width) * lngRange,
    lat: bounds.maxLat - (point.y / VIEWBOX.height) * latRange,
  };
}

function polygonPoints(points, bounds) {
  return points
    .map((point) => project(point, bounds))
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function driverColor(status) {
  if (["online", "available", "active"].includes(status)) return "#237a57";
  if (["busy", "in_trip", "trip"].includes(status)) return "#3d6b91";
  if (["blocked", "offline"].includes(status)) return "#9a4a42";
  return "#6b7a72";
}

function cellColor(cell) {
  return cell.style?.fill || cell.style?.fillColor || "#4a9b70";
}

function cellOpacity(cell) {
  const value = finiteNumber(cell.style?.fillOpacity ?? cell.style?.opacity);
  return value === null ? 0.16 : Math.max(0.05, Math.min(0.5, value));
}

export default function LeafOperationsMap({
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
  showH3SyncLabel = true,
}) {
  const normalizedDrivers = useMemo(() => drivers.map(normalizeDriver).filter(Boolean), [drivers]);
  const normalizedCells = useMemo(() => h3Cells.map(normalizeCell).filter(Boolean), [h3Cells]);
  const normalizedGeofenceRings = useMemo(
    () => normalizeGeofenceRings(geofenceRegion),
    [geofenceRegion],
  );
  const normalizedGeofence = useMemo(
    () => normalizedGeofenceRings.flat(),
    [normalizedGeofenceRings],
  );
  const bounds = useMemo(
    () => buildBounds({ drivers: normalizedDrivers, geofence: normalizedGeofence }),
    [normalizedDrivers, normalizedGeofence],
  );
  const isCompositeGeofence = normalizedGeofenceRings.length > 1;
  const canEditOnMap = geofenceEditable && !isCompositeGeofence;
  const editableVertices = useMemo(
    () => (normalizedGeofenceRings.length === 1 ? openPolygon(normalizedGeofenceRings[0]) : []),
    [normalizedGeofenceRings],
  );

  useEffect(() => {
    if (typeof onViewportChange !== "function") return;
    const bbox = [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat]
      .map((value) => value.toFixed(6))
      .join(",");
    onViewportChange({ bbox, zoom: approximateZoom(bounds) });
  }, [bounds, onViewportChange]);

  const emitRegion = (points) => {
    if (typeof onGeofenceChange !== "function") return;
    onGeofenceChange(closePolygon(points).map((point) => [point.lng, point.lat]));
  };

  const handleMapClick = (event) => {
    if (!canEditOnMap) return;
    const svg = event.currentTarget;
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const localPoint = cursor.matrixTransform(screenMatrix.inverse());
    if (localPoint.x < 0 || localPoint.x > VIEWBOX.width || localPoint.y < 0 || localPoint.y > VIEWBOX.height) return;
    const point = unproject({
      x: localPoint.x,
      y: localPoint.y,
    }, bounds);
    emitRegion([...editableVertices, point]);
  };

  const undoPoint = () => emitRegion(editableVertices.slice(0, -1));
  const clearRegion = () => onGeofenceChange?.([]);
  const geofencePointCount = normalizedGeofenceRings.reduce((total, ring) => total + ring.length, 0);
  const hasData = normalizedDrivers.length || normalizedCells.length || geofencePointCount >= 3;

  return (
    <div className={canEditOnMap ? "leaf-operations-map leaf-operations-map-editing" : "leaf-operations-map"} style={{ minHeight: mapHeight }}>
      <div className="leaf-map-toolbar">
        <div>
          <strong>Mapa Leaf</strong>
          <span>Dados operacionais via APIs Leaf · nenhum provider pago no navegador</span>
        </div>
        <div className="leaf-map-actions">
          {showH3SyncLabel ? (
            <span className={h3Error ? "status-bad" : h3Loading ? "status-warn" : "status-ok"}>
              H3 {h3Error ? "com erro" : h3Loading ? "atualizando" : h3LastUpdatedAt ? "sincronizado" : "aguardando"}
            </span>
          ) : null}
          {geofenceEditable ? (
            <>
              {canEditOnMap ? (
                <>
                  <span className="meta-badge">Adicione pontos no mapa ou use coordenadas abaixo</span>
                  <button type="button" onClick={undoPoint} disabled={!editableVertices.length}>Desfazer ponto</button>
                  <button type="button" onClick={clearRegion} disabled={!editableVertices.length}>Limpar</button>
                </>
              ) : (
                <span className="status-warn">
                  Região composta por {normalizedGeofenceRings.length} áreas · edite por coordenadas para preservar todas
                </span>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="leaf-map-canvas-wrap">
        <svg
          className="leaf-map-svg"
          viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
          role="img"
          aria-label={
            geofenceEditable && isCompositeGeofence
              ? "Mapa Leaf da geofence composta; edição disponível por coordenadas"
              : geofenceEditable
                ? "Mapa Leaf em modo de edição da geofence"
                : "Mapa operacional Leaf"
          }
          onClick={handleMapClick}
        >
          <defs>
            <linearGradient id="leafOpsBackground" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f2f5f0" />
              <stop offset="100%" stopColor="#e4ebe2" />
            </linearGradient>
            <pattern id="leafOpsGrid" width="46" height="46" patternUnits="userSpaceOnUse">
              <path d="M46 0H0V46" fill="none" stroke="#ccd7ce" strokeWidth="1" opacity="0.48" />
            </pattern>
          </defs>
          <rect width={VIEWBOX.width} height={VIEWBOX.height} fill="url(#leafOpsBackground)" />
          <rect width={VIEWBOX.width} height={VIEWBOX.height} fill="url(#leafOpsGrid)" />
          <path d="M0,440 C140,350 245,405 365,338 C500,264 642,324 760,246 C835,196 882,202 920,176 L920,520 L0,520 Z" fill="#dbe7da" opacity="0.88" />

          {normalizedCells.map((cell) => (
            <polygon
              key={cell.id}
              points={polygonPoints(cell.boundary, bounds)}
              fill={cellColor(cell)}
              fillOpacity={cellOpacity(cell)}
              stroke={cell.style?.stroke || "#397b59"}
              strokeOpacity="0.55"
              strokeWidth="1.2"
              pointerEvents={canEditOnMap ? "none" : "auto"}
              onClick={canEditOnMap ? undefined : (event) => event.stopPropagation()}
            >
              <title>{`${cell.id} · oferta ${cell.metrics?.supply ?? "-"} · demanda ${cell.metrics?.demand ?? "-"}`}</title>
            </polygon>
          ))}

          {normalizedGeofenceRings.map((ring, index) => (
            <polyline
              key={`geofence-ring-${index}`}
              points={polygonPoints(sampleRing(ring), bounds)}
              fill="rgba(15, 81, 54, 0.13)"
              stroke="#0f5136"
              strokeWidth={geofenceEditable ? "3.6" : "3.2"}
              strokeDasharray="0"
              pointerEvents="none"
            />
          ))}

          {canEditOnMap ? editableVertices.map((point, index) => {
            const projected = project(point, bounds);
            return (
              <g key={`${point.lng}:${point.lat}:${index}`} pointerEvents="none">
                <circle cx={projected.x} cy={projected.y} r="8" fill="#fff" stroke="#17613e" strokeWidth="3" />
                <text x={projected.x + 11} y={projected.y - 9} className="leaf-map-point-label">{index + 1}</text>
              </g>
            );
          }) : null}

          {normalizedDrivers.map((driver) => {
            const point = project(driver, bounds);
            return (
              <g
                key={driver.id}
                pointerEvents={canEditOnMap ? "none" : "auto"}
                onClick={canEditOnMap ? undefined : (event) => event.stopPropagation()}
              >
                <circle cx={point.x} cy={point.y} r="11" fill={driverColor(driver.status)} opacity="0.15" />
                <circle cx={point.x} cy={point.y} r="5" fill={driverColor(driver.status)} stroke="#fff" strokeWidth="2" />
                <title>{`${driver.name} · ${driver.status}`}</title>
              </g>
            );
          })}
        </svg>

        {!hasData ? (
          <div className="leaf-map-empty">Nenhum dado plotável retornou para este viewport.</div>
        ) : null}
      </div>

      <div className="leaf-map-footer">
        <span>{normalizedDrivers.length} motoristas</span>
        <span>{normalizedCells.length} células H3</span>
        <span>{normalizedGeofenceRings.length} área(s) · {geofencePointCount} pontos de geofence</span>
      </div>
    </div>
  );
}
