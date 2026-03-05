"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import GoogleDriversMap from "@/src/components/map/GoogleDriversMap";

export default function MapsPage() {
  const [locations, setLocations] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [normalizedDrivers, setNormalizedDrivers] = useState([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) setLoading(true);
        const response = await leafAPI.getMapLocations("all");
        if (mounted) {
          setLocations(response);
          const drivers = (response?.locations?.drivers || []).filter(
            (d) => d?.location && Number.isFinite(Number(d.location.lat)) && Number.isFinite(Number(d.location.lng)),
          );

          if (drivers.length > 0) {
            const lats = drivers.map((d) => Number(d.location.lat));
            const lngs = drivers.map((d) => Number(d.location.lng));
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const minLng = Math.min(...lngs);
            const maxLng = Math.max(...lngs);

            const mapped = drivers.map((driver) => {
              const lat = Number(driver.location.lat);
              const lng = Number(driver.location.lng);
              const x = maxLng === minLng ? 50 : ((lng - minLng) / (maxLng - minLng)) * 100;
              const y = maxLat === minLat ? 50 : ((maxLat - lat) / (maxLat - minLat)) * 100;
              return { ...driver, x, y };
            });
            setNormalizedDrivers(mapped);
          } else {
            setNormalizedDrivers([]);
          }
        }
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar mapas");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Mapas</h1>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando dados de mapa..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Motoristas" value={locations?.summary?.totalDrivers || 0} />
          <KpiCard
            title="Disponíveis"
            value={locations?.summary?.availableDrivers || 0}
            tone="positive"
          />
          <KpiCard title="Passageiros Ativos" value={locations?.summary?.activePassengers || 0} />
          <KpiCard title="Corridas Ativas" value={locations?.summary?.activeBookings || 0} />
        </section>

        <section className="grid">
          <Panel title="Resumo">
            <pre>{JSON.stringify(locations?.summary || {}, null, 2)}</pre>
          </Panel>
          <Panel title="Localizações">
            <pre>{JSON.stringify(locations?.locations || {}, null, 2)}</pre>
          </Panel>
          <Panel title="Motoristas (amostra)">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Lat</th>
                  <th>Lng</th>
                </tr>
              </thead>
              <tbody>
                {(locations?.locations?.drivers || []).slice(0, 12).map((driver, idx) => (
                  <tr key={driver.id || idx}>
                    <td>{driver.id || "-"}</td>
                    <td>{driver.status || "-"}</td>
                    <td>{driver.location?.lat ?? "-"}</td>
                    <td>{driver.location?.lng ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Mapa de dispersão (motoristas)">
            {normalizedDrivers.length === 0 ? (
              <p>Sem coordenadas suficientes para renderizar o mapa.</p>
            ) : (
              <div className="map-canvas">
                {normalizedDrivers.map((driver, idx) => (
                  <div
                    key={driver.id || idx}
                    className={driver.status === "online" ? "map-dot map-dot-online" : "map-dot map-dot-offline"}
                    style={{ left: `${driver.x}%`, top: `${driver.y}%` }}
                    title={`${driver.id || "driver"} (${driver.status || "unknown"})`}
                  />
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Google Maps (motoristas)">
            <GoogleDriversMap drivers={locations?.locations?.drivers || []} />
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
