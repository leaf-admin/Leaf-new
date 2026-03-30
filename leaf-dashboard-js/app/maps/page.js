"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import { authService } from "@/src/services/auth-service";
import config from "@/src/config";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import GoogleDriversMap from "@/src/components/map/GoogleDriversMap";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const H3_VIEWPORT_DEBOUNCE_MS = 400;
const H3_SOCKET_REFRESH_DEBOUNCE_MS = 900;

function formatRegionDraft(region) {
  if (!Array.isArray(region)) return "[]";
  return JSON.stringify(region, null, 2);
}

export default function MapsPage() {
  const [locations, setLocations] = useState(null);
  const [h3Cells, setH3Cells] = useState([]);
  const [h3Loading, setH3Loading] = useState(false);
  const [h3Error, setH3Error] = useState("");
  const [mapViewport, setMapViewport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [normalizedDrivers, setNormalizedDrivers] = useState([]);
  const [wsStatus, setWsStatus] = useState("desconectado");
  const [geoLoading, setGeoLoading] = useState(true);
  const [geoError, setGeoError] = useState("");
  const [geoConfig, setGeoConfig] = useState(null);
  const [selectedStateCode, setSelectedStateCode] = useState("RJ");
  const [stateBusy, setStateBusy] = useState(false);
  const [cityBusyKey, setCityBusyKey] = useState("");
  const [newCityName, setNewCityName] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [cityCapDraft, setCityCapDraft] = useState({});
  const [cityWaitlistDraft, setCityWaitlistDraft] = useState({});
  const [geofenceBusy, setGeofenceBusy] = useState(false);
  const [geofenceEnabledDraft, setGeofenceEnabledDraft] = useState(true);
  const [geofenceRegionDraft, setGeofenceRegionDraft] = useState("[]");
  const h3ViewportRequestRef = useRef("");
  const h3SocketRefreshTimerRef = useRef(null);
  const [h3RefreshNonce, setH3RefreshNonce] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) setLoading(true);
        const response = await leafAPI.getMapLocations("all");
        if (mounted) {
          setLocations(response);
          setError("");
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

  const handleMapViewportChange = useCallback((viewport) => {
    if (!viewport?.bbox || !Number.isFinite(Number(viewport?.zoom))) {
      return;
    }

    const nextKey = `${viewport.bbox}:${viewport.zoom}`;
    if (nextKey === h3ViewportRequestRef.current) {
      return;
    }

    h3ViewportRequestRef.current = nextKey;
    setMapViewport({
      bbox: viewport.bbox,
      zoom: Number(viewport.zoom),
    });
  }, []);

  const scheduleH3Refresh = useCallback(() => {
    if (!mapViewport?.bbox || !Number.isFinite(Number(mapViewport?.zoom))) {
      return;
    }

    if (h3SocketRefreshTimerRef.current) {
      clearTimeout(h3SocketRefreshTimerRef.current);
    }

    h3SocketRefreshTimerRef.current = setTimeout(() => {
      setH3RefreshNonce((current) => current + 1);
      h3SocketRefreshTimerRef.current = null;
    }, H3_SOCKET_REFRESH_DEBOUNCE_MS);
  }, [mapViewport]);

  useEffect(() => {
    if (!mapViewport?.bbox || !Number.isFinite(Number(mapViewport?.zoom))) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setH3Loading(true);
        setH3Error("");
        const response = await leafAPI.getMapH3Cells(
          {
            bbox: mapViewport.bbox,
            zoom: mapViewport.zoom,
            surface: "dashboard",
            mode: "supply_demand",
            includeBoundary: true,
            includeEmpty: true,
          },
          { signal: controller.signal },
        );
        setH3Cells(Array.isArray(response?.cells) ? response.cells : []);
      } catch (err) {
        if (controller.signal.aborted) return;
        setH3Error(err?.message || "Falha ao carregar células H3");
      } finally {
        if (!controller.signal.aborted) {
          setH3Loading(false);
        }
      }
    }, H3_VIEWPORT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [h3RefreshNonce, mapViewport]);

  useEffect(() => {
    return () => {
      if (h3SocketRefreshTimerRef.current) {
        clearTimeout(h3SocketRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const drivers = (locations?.locations?.drivers || []).filter(
      (d) => d?.location && Number.isFinite(Number(d.location.lat)) && Number.isFinite(Number(d.location.lng)),
    );
    if (drivers.length === 0) {
      setNormalizedDrivers([]);
      return;
    }

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
  }, [locations]);

  useEffect(() => {
    const token = authService.getAccessToken();
    if (!token) {
      setWsStatus("sem-token");
      return;
    }

    const socket = io(`${config.ws.baseUrl}/dashboard`, {
      auth: { jwtToken: token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
    });

    socket.on("connect", () => {
      setWsStatus("conectado");
      socket.emit("authenticate", { jwtToken: token });
    });

    socket.on("authenticated", () => {
      socket.emit("request_live_data");
    });

    socket.on("authentication_error", () => {
      setWsStatus("auth-erro");
    });

    socket.on("connect_error", () => {
      setWsStatus("erro");
    });

    const onLiveStats = (stats) => {
      if (!stats) return;
      setLocations((prev) => ({
        ...(prev || {}),
        summary: {
          ...(prev?.summary || {}),
          totalDrivers: Number(stats.driversOnline || prev?.summary?.totalDrivers || 0),
          availableDrivers: Number(stats.driversAvailable || prev?.summary?.availableDrivers || 0),
          busyDrivers: Number(stats.driversBusy || prev?.summary?.busyDrivers || 0),
          activeBookings: Number(stats.activeTrips || prev?.summary?.activeBookings || 0),
        },
      }));
    };

    const onDrivers = (payload) => {
      const drivers = Array.isArray(payload?.drivers) ? payload.drivers : [];
      setLocations((prev) => ({
        ...(prev || {}),
        locations: {
          ...(prev?.locations || {}),
          drivers,
          passengers: prev?.locations?.passengers || [],
          activeBookings: prev?.locations?.activeBookings || [],
        },
      }));
      scheduleH3Refresh();
    };

    const onTrips = (payload) => {
      const trips = Array.isArray(payload?.trips) ? payload.trips : [];
      setLocations((prev) => ({
        ...(prev || {}),
        locations: {
          ...(prev?.locations || {}),
          drivers: prev?.locations?.drivers || [],
          passengers: prev?.locations?.passengers || [],
          activeBookings: trips,
        },
        summary: {
          ...(prev?.summary || {}),
          activeBookings: trips.length || prev?.summary?.activeBookings || 0,
        },
      }));
      scheduleH3Refresh();
    };

    const onH3Refresh = () => {
      scheduleH3Refresh();
    };

    socket.on("live_stats", onLiveStats);
    socket.on("live_stats_update", onLiveStats);
    socket.on("driver_location_update", onDrivers);
    socket.on("trip_update", onTrips);
    socket.on("map_h3_refresh", onH3Refresh);

    return () => {
      socket.off("live_stats", onLiveStats);
      socket.off("live_stats_update", onLiveStats);
      socket.off("driver_location_update", onDrivers);
      socket.off("trip_update", onTrips);
      socket.off("map_h3_refresh", onH3Refresh);
      socket.disconnect();
      setWsStatus("desconectado");
    };
  }, [scheduleH3Refresh]);

  const loadGeoConfig = useCallback(async () => {
    try {
      setGeoLoading(true);
      setGeoError("");
      const response = await leafAPI.getGeofenceAdminConfig();
      setGeoConfig(response);
      setGeofenceEnabledDraft(response?.geofence?.enabled !== false);
      setGeofenceRegionDraft(formatRegionDraft(response?.geofence?.region || []));
      const states = response?.cityActivation?.states || [];
      if (states.length > 0) {
        setSelectedStateCode((prev) => {
          if (states.some((state) => state.stateCode === prev)) {
            return prev;
          }
          const rj = states.find((state) => state.stateCode === "RJ");
          return rj?.stateCode || states[0].stateCode;
        });
      }
    } catch (err) {
      setGeoError(err?.message || "Falha ao carregar configuracao geografica");
    } finally {
      setGeoLoading(false);
    }
  }, []);

  const toggleGeofenceEnabled = async () => {
    const currentEnabled = geoConfig?.geofence?.enabled !== false;
    const nextEnabled = !currentEnabled;

    try {
      setGeofenceBusy(true);
      setGeoError("");
      await leafAPI.updateGeofenceConfig({ enabled: nextEnabled });
      await loadGeoConfig();
    } catch (err) {
      setGeoError(err?.message || "Falha ao atualizar status da geofence");
    } finally {
      setGeofenceBusy(false);
    }
  };

  const saveGeofenceRegion = async () => {
    let parsedRegion = null;
    try {
      parsedRegion = JSON.parse(geofenceRegionDraft);
      if (!Array.isArray(parsedRegion)) {
        throw new Error("Formato invalido");
      }
    } catch {
      setGeoError("Poligono invalido. Use JSON no formato [[lng,lat], ...].");
      return;
    }

    try {
      setGeofenceBusy(true);
      setGeoError("");
      await leafAPI.updateGeofenceConfig({
        region: parsedRegion,
        enabled: geofenceEnabledDraft,
      });
      await loadGeoConfig();
    } catch (err) {
      setGeoError(err?.message || "Falha ao salvar poligono da geofence");
    } finally {
      setGeofenceBusy(false);
    }
  };

  const resetGeofenceDraft = () => {
    setGeofenceEnabledDraft(geoConfig?.geofence?.enabled !== false);
    setGeofenceRegionDraft(formatRegionDraft(geoConfig?.geofence?.region || []));
  };

  useEffect(() => {
    loadGeoConfig();
  }, [loadGeoConfig]);

  const geographyStates = useMemo(() => geoConfig?.cityActivation?.states || [], [geoConfig]);
  const selectedState = useMemo(() => {
    if (geographyStates.length === 0) return null;
    return geographyStates.find((state) => state.stateCode === selectedStateCode) || geographyStates[0];
  }, [geographyStates, selectedStateCode]);
  const filteredCities = useMemo(() => {
    const term = citySearch.trim().toLowerCase();
    const cities = selectedState?.cities || [];
    if (!term) return cities;
    return cities.filter((city) =>
      `${city?.label || city?.name || ""} ${city?.value || city?.key || ""}`.toLowerCase().includes(term),
    );
  }, [selectedState, citySearch]);

  useEffect(() => {
    const cityRows = selectedState?.cities || [];
    const nextCaps = {};
    const nextWaitlist = {};
    cityRows.forEach((city) => {
      nextCaps[city.key] = Number(city.maxActiveDrivers || 0);
      nextWaitlist[city.key] = city.waitlistEnabled !== false;
    });
    setCityCapDraft(nextCaps);
    setCityWaitlistDraft(nextWaitlist);
  }, [selectedState]);

  const refreshMapLocations = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await leafAPI.getMapLocations("all");
      setLocations(response);
    } catch (err) {
      setError(err?.message || "Falha ao carregar mapas");
    } finally {
      setLoading(false);
    }
  };

  const toggleStateActivation = async () => {
    if (!selectedState) return;
    try {
      setStateBusy(true);
      setGeoError("");
      await leafAPI.updateGeofenceState(selectedState.stateCode, !selectedState.enabled);
      await loadGeoConfig();
    } catch (err) {
      setGeoError(err?.message || "Falha ao atualizar estado");
    } finally {
      setStateBusy(false);
    }
  };

  const toggleCityActivation = async (city) => {
    if (!selectedState || !city?.key) return;
    try {
      setCityBusyKey(city.key);
      setGeoError("");
      await leafAPI.updateGeofenceCity(selectedState.stateCode, city.key, !city.active);
      await loadGeoConfig();
    } catch (err) {
      setGeoError(err?.message || "Falha ao atualizar cidade");
    } finally {
      setCityBusyKey("");
    }
  };

  const createCity = async () => {
    if (!selectedState || newCityName.trim().length < 2) {
      setGeoError("Informe um nome valido para nova cidade");
      return;
    }

    try {
      setCityBusyKey("create-city");
      setGeoError("");
      await leafAPI.createGeofenceCity({
        stateCode: selectedState.stateCode,
        name: newCityName.trim(),
        active: false,
      });
      setNewCityName("");
      await loadGeoConfig();
    } catch (err) {
      setGeoError(err?.message || "Falha ao criar cidade");
    } finally {
      setCityBusyKey("");
    }
  };

  const saveCityCapacity = async (city) => {
    if (!selectedState || !city?.key) return;
    const maxActiveDrivers = Number(cityCapDraft[city.key]);
    const waitlistEnabled = cityWaitlistDraft[city.key] !== false;

    if (!Number.isFinite(maxActiveDrivers) || maxActiveDrivers < 0) {
      setGeoError("Capacidade da cidade deve ser numero >= 0");
      return;
    }

    try {
      setCityBusyKey(`city-config-${city.key}`);
      setGeoError("");
      await leafAPI.updateGeofenceCity(selectedState.stateCode, city.key, {
        maxActiveDrivers,
        waitlistEnabled,
      });
      await loadGeoConfig();
    } catch (err) {
      setGeoError(err?.message || "Falha ao atualizar capacidade da cidade");
    } finally {
      setCityBusyKey("");
    }
  };

  const allErrors = [error, geoError].filter(Boolean).join(" | ");

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Mapas e Geofence</h1>
          <div className="filters">
            <span className={wsStatus === "conectado" ? "status-ok" : "status-warn"}>WS: {wsStatus}</span>
            <button onClick={refreshMapLocations}>Atualizar mapa</button>
            <button onClick={loadGeoConfig}>Atualizar geografia</button>
          </div>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando dados de mapa..." /> : null}

        <section className="grid">
          <Panel
            title="Controle Geografico (Geofence + Cidades)"
            subtitle="Ative estados/cidades e ajuste capacidade de operação com waitlist."
          >
            {geoLoading ? <p>Carregando configuracao geografica...</p> : null}
            <div className="filters">
              <span className={geoConfig?.geofence?.active ? "status-ok" : "status-warn"}>
                Geofence runtime: {geoConfig?.geofence?.active ? "ativo" : "inativo"}
              </span>
              <span className={geoConfig?.geofence?.enabled !== false ? "status-ok" : "status-warn"}>
                Config: {geoConfig?.geofence?.enabled !== false ? "habilitada" : "desabilitada"}
              </span>
              <span className={geoConfig?.geofence?.bypassEnabled ? "status-warn" : "status-ok"}>
                Bypass: {geoConfig?.geofence?.bypassEnabled ? "ligado" : "desligado"}
              </span>
              <span className="meta-badge">Pontos do poligono: {geoConfig?.geofence?.regionPoints || 0}</span>
              <span className="meta-badge">Storage cidades: {geoConfig?.storage || "-"}</span>
              <span className="meta-badge">Storage geofence: {geoConfig?.geofenceStorage || "-"}</span>
              <span className="meta-badge">Estados: {geoConfig?.cityActivation?.summary?.totalStates || 0}</span>
              <span className="meta-badge">Cidades ativas: {geoConfig?.cityActivation?.summary?.activeCities || 0}</span>
              <span className="meta-badge">Capacidade total: {geoConfig?.cityActivation?.summary?.totalCapacity || 0}</span>
            </div>

            <div className="filters">
              <button onClick={toggleGeofenceEnabled} disabled={geoLoading || geofenceBusy}>
                {geoConfig?.geofence?.enabled !== false ? "Desativar geofence" : "Ativar geofence"}
              </button>
              <button onClick={saveGeofenceRegion} disabled={geoLoading || geofenceBusy}>
                Salvar poligono
              </button>
              <button onClick={resetGeofenceDraft} disabled={geoLoading || geofenceBusy}>
                Reverter rascunho
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label htmlFor="geofence-region-draft" style={{ display: "block", marginBottom: 6 }}>
                Poligono da geofence (JSON)
              </label>
              <textarea
                id="geofence-region-draft"
                value={geofenceRegionDraft}
                onChange={(event) => setGeofenceRegionDraft(event.target.value)}
                rows={6}
                style={{ width: "100%", resize: "vertical", fontFamily: "monospace" }}
                placeholder='[[-43.8,-23.1],[-43.1,-23.1],[-43.1,-22.7],[-43.8,-22.7],[-43.8,-23.1]]'
              />
              <small style={{ color: "#64748b" }}>
                Dica: o backend aceita array de coordenadas no formato [lng, lat] e fecha o poligono automaticamente.
              </small>
            </div>

            <div className="filters">
              <select
                value={selectedState?.stateCode || selectedStateCode}
                onChange={(event) => setSelectedStateCode(event.target.value)}
                disabled={geographyStates.length === 0 || geoLoading}
              >
                {geographyStates.map((state) => (
                  <option key={state.stateCode} value={state.stateCode}>
                    {state.name} ({state.stateCode})
                  </option>
                ))}
              </select>
              <button onClick={toggleStateActivation} disabled={!selectedState || stateBusy}>
                {selectedState?.enabled ? "Desativar estado" : "Ativar estado"}
              </button>
              <span className="meta-badge">
                {selectedState
                  ? `Ativas ${selectedState.activeCities}/${selectedState.totalCities}`
                  : "Sem estado selecionado"}
              </span>
            </div>

            <div className="filters">
              <input
                placeholder={`Nova cidade em ${selectedState?.stateCode || "UF"}`}
                value={newCityName}
                onChange={(event) => setNewCityName(event.target.value)}
              />
              <input
                placeholder="Filtrar cidades por nome/slug"
                value={citySearch}
                onChange={(event) => setCitySearch(event.target.value)}
              />
              <button
                onClick={createCity}
                disabled={!selectedState || newCityName.trim().length < 2 || cityBusyKey === "create-city"}
              >
                Adicionar cidade
              </button>
            </div>

            <div className="table-shell table-shell-tight" style={{ maxHeight: 300 }}>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Cidade</th>
                    <th>Slug</th>
                    <th>Status</th>
                    <th>Capacidade</th>
                    <th>Waitlist</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCities.map((city) => (
                    <tr key={city.key}>
                      <td>{city.label || city.name || "-"}</td>
                      <td>
                        <code>{city.value || city.key || "-"}</code>
                      </td>
                      <td>
                        <span className={city.active ? "status-ok" : "status-warn"}>
                          {city.active ? "Ativa" : "Inativa"}
                        </span>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={cityCapDraft[city.key] ?? city.maxActiveDrivers ?? 0}
                          onChange={(event) =>
                            setCityCapDraft((prev) => ({
                              ...prev,
                              [city.key]: event.target.value,
                            }))
                          }
                          style={{ width: 100 }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={cityWaitlistDraft[city.key] ?? (city.waitlistEnabled !== false)}
                          onChange={(event) =>
                            setCityWaitlistDraft((prev) => ({
                              ...prev,
                              [city.key]: event.target.checked,
                            }))
                          }
                        />
                      </td>
                      <td>
                        <div className="actions-cell">
                          <button
                            disabled={cityBusyKey === `city-config-${city.key}`}
                            onClick={() => saveCityCapacity(city)}
                          >
                            Salvar
                          </button>
                          <button
                            disabled={cityBusyKey === city.key}
                            onClick={() => toggleCityActivation(city)}
                          >
                            {city.active ? "Desativar" : "Ativar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!selectedState || filteredCities.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Nenhuma cidade cadastrada para este estado.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <section className="grid grid-kpi">
          <KpiCard title="Motoristas" value={locations?.summary?.totalDrivers || 0} />
          <KpiCard
            title="Disponíveis"
            value={locations?.summary?.availableDrivers || 0}
            tone="positive"
          />
          <KpiCard title="Passageiros Ativos" value={locations?.summary?.activePassengers || 0} />
          <KpiCard title="Corridas Ativas" value={locations?.summary?.activeBookings || 0} />
          <KpiCard
            title="Passageiros/Motorista"
            value={
              Number.isFinite(Number(locations?.summary?.passengerDriverRatio))
                ? Number(locations?.summary?.passengerDriverRatio).toFixed(2)
                : "N/D"
            }
          />
          <KpiCard
            title="Motoristas/km²"
            value={
              Number.isFinite(Number(locations?.summary?.driverDensityPerKm2))
                ? Number(locations?.summary?.driverDensityPerKm2).toFixed(2)
                : "N/D"
            }
          />
        </section>

        <section className="grid">
          <Panel title="Resumo operacional" subtitle="Indicadores consolidados de oferta, demanda e densidade.">
            <KeyValueGrid
              data={{
                totalDrivers: locations?.summary?.totalDrivers || 0,
                availableDrivers: locations?.summary?.availableDrivers || 0,
                busyDrivers: locations?.summary?.busyDrivers || 0,
                activePassengers: locations?.summary?.activePassengers || 0,
                activeBookings: locations?.summary?.activeBookings || 0,
                passengerDriverRatio: Number.isFinite(Number(locations?.summary?.passengerDriverRatio))
                  ? Number(locations?.summary?.passengerDriverRatio).toFixed(2)
                  : "N/D",
                driverDensityPerKm2: Number.isFinite(Number(locations?.summary?.driverDensityPerKm2))
                  ? Number(locations?.summary?.driverDensityPerKm2).toFixed(2)
                  : "N/D",
              }}
              labels={{
                totalDrivers: "Motoristas monitorados",
                availableDrivers: "Motoristas disponíveis",
                busyDrivers: "Motoristas ocupados",
                activePassengers: "Passageiros ativos",
                activeBookings: "Corridas ativas",
                passengerDriverRatio: "Passageiros por motorista",
                driverDensityPerKm2: "Motoristas por km²",
              }}
            />
          </Panel>
          <Panel title="Status do stream de localizacao" subtitle="Saúde do feed em tempo real e contexto geográfico.">
            <KeyValueGrid
              data={{
                driversInStream: (locations?.locations?.drivers || []).length,
                passengersInStream: (locations?.locations?.passengers || []).length,
                activeTripsInStream: (locations?.locations?.activeBookings || []).length,
                wsStatus,
                selectedState: selectedState?.stateCode || selectedStateCode,
                citiesLoaded: (selectedState?.cities || []).length,
              }}
              labels={{
                driversInStream: "Motoristas no stream",
                passengersInStream: "Passageiros no stream",
                activeTripsInStream: "Corridas no stream",
                wsStatus: "WebSocket",
                selectedState: "Estado selecionado",
                citiesLoaded: "Cidades cadastradas",
              }}
            />
            <TechnicalDetails
              title="Ver payload técnico de localizações"
              data={{
                summary: locations?.summary || {},
                locations: locations?.locations || {},
              }}
            />
          </Panel>
          <Panel title="Motoristas (amostra)" subtitle="Leitura rápida das últimas posições reportadas.">
            <div className="table-shell">
              <table className="table table-compact">
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
            </div>
          </Panel>
          <Panel title="Mapa de dispersão (motoristas)" subtitle="Visão agregada para análise de cobertura.">
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
          <Panel title="Google Maps (motoristas)" subtitle="Mapa operacional com pontos reais da frota online.">
            <GoogleDriversMap
              drivers={locations?.locations?.drivers || []}
              h3Cells={h3Cells}
              h3Loading={h3Loading}
              h3Error={h3Error}
              onViewportChange={handleMapViewportChange}
            />
          </Panel>
        </section>
        <ErrorText message={allErrors} />
      </main>
    </ProtectedRoute>
  );
}
