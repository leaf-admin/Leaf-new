"use client";

import { useMemo, useState } from "react";
import { GoogleMap, HeatmapLayerF, MarkerClustererF, MarkerF, useJsApiLoader } from "@react-google-maps/api";

const MAP_STYLE = {
  width: "100%",
  height: "360px",
  borderRadius: "10px",
};

function getCenter(points) {
  if (!points.length) return { lat: -22.9068, lng: -43.1729 }; // Rio fallback
  const acc = points.reduce(
    (sum, point) => ({
      lat: sum.lat + Number(point.location.lat),
      lng: sum.lng + Number(point.location.lng),
    }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: acc.lat / points.length,
    lng: acc.lng / points.length,
  };
}

export default function GoogleDriversMap({ drivers = [] }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const hasKey = Boolean(apiKey);
  const [mapMode, setMapMode] = useState("cluster"); // cluster | heatmap

  const { isLoaded, loadError } = useJsApiLoader({
    id: "leaf-google-maps",
    googleMapsApiKey: apiKey,
    libraries: ["visualization"],
  });

  const validDrivers = drivers.filter(
    (driver) =>
      driver?.location &&
      Number.isFinite(Number(driver.location.lat)) &&
      Number.isFinite(Number(driver.location.lng)),
  );
  const center = getCenter(validDrivers);
  const heatmapData = useMemo(() => {
    if (!isLoaded || !globalThis?.window?.google?.maps) return [];
    return validDrivers.map(
      (driver) => new window.google.maps.LatLng(Number(driver.location.lat), Number(driver.location.lng)),
    );
  }, [isLoaded, validDrivers]);

  if (!hasKey) {
    return <p>Google Maps API key não configurada (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).</p>;
  }

  if (loadError) {
    return <p>Falha ao carregar Google Maps.</p>;
  }

  if (!isLoaded) {
    return <p>Carregando Google Maps...</p>;
  }

  if (!validDrivers.length) {
    return (
      <GoogleMap
        mapContainerStyle={MAP_STYLE}
        center={{ lat: -22.9068, lng: -43.1729 }}
        zoom={11}
        options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
      />
    );
  }

  return (
    <div className="google-map-wrap">
      <div className="google-map-toolbar">
        <button
          type="button"
          className={mapMode === "cluster" ? "mode-btn mode-btn-active" : "mode-btn"}
          onClick={() => setMapMode("cluster")}
        >
          Clusters
        </button>
        <button
          type="button"
          className={mapMode === "heatmap" ? "mode-btn mode-btn-active" : "mode-btn"}
          onClick={() => setMapMode("heatmap")}
        >
          Heatmap
        </button>
      </div>

      <GoogleMap
        mapContainerStyle={MAP_STYLE}
        center={center}
        zoom={12}
        options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
      >
        {mapMode === "heatmap" ? (
          <HeatmapLayerF
            data={heatmapData}
            options={{
              radius: 35,
              opacity: 0.8,
              gradient: [
                "rgba(0, 255, 255, 0)",
                "rgba(0, 255, 255, 1)",
                "rgba(0, 191, 255, 1)",
                "rgba(0, 127, 255, 1)",
                "rgba(0, 63, 255, 1)",
                "rgba(0, 0, 255, 1)",
                "rgba(0, 0, 223, 1)",
                "rgba(0, 0, 191, 1)",
                "rgba(0, 0, 159, 1)",
                "rgba(0, 0, 127, 1)",
                "rgba(63, 0, 91, 1)",
                "rgba(127, 0, 63, 1)",
                "rgba(191, 0, 31, 1)",
                "rgba(255, 0, 0, 1)",
              ],
            }}
          />
        ) : (
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
        )}
      </GoogleMap>
    </div>
  );
}
