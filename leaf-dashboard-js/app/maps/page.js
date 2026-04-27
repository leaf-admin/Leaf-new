"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import { wsService } from "@/src/services/websocket-service";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import GoogleDriversMap from "@/src/components/map/GoogleDriversMap";
import { TechnicalDetails } from "@/src/components/ui/DataViews";

const H3_VIEWPORT_DEBOUNCE_MS = 400;
const H3_SOCKET_REFRESH_DEBOUNCE_MS = 1500;
const H3_SOCKET_REFRESH_MIN_INTERVAL_MS = 12000;

function formatRegionDraft(region) {
  if (!Array.isArray(region)) return "[]";
  return JSON.stringify(region, null, 2);
}

function parseRegionDraft(regionDraft) {
  if (typeof regionDraft !== "string") return [];

  let parsed = null;
  try {
    parsed = JSON.parse(regionDraft);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return [];

  const normalized = [];
  for (const point of parsed) {
    let lng = null;
    let lat = null;
    if (Array.isArray(point) && point.length >= 2) {
      lng = Number(point[0]);
      lat = Number(point[1]);
    } else if (point && typeof point === "object") {
      lng = Number(point.lng);
      lat = Number(point.lat);
    } else {
      return null;
    }

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    normalized.push([lng, lat]);
  }

  if (normalized.length < 3) return null;
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    normalized.push([first[0], first[1]]);
  }
  return normalized;
}

export default function MapsPage() {
  const [locations, setLocations] = useState(null);
  const [h3Cells, setH3Cells] = useState([]);
  const [h3Loading, setH3Loading] = useState(false);
  const [h3Error, setH3Error] = useState("");
  const [h3LastUpdatedAt, setH3LastUpdatedAt] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
  const mapViewportRef = useRef(null);
  const h3SocketRefreshTimerRef = useRef(null);
  const h3SocketRefreshLastAtRef = useRef(0);
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

  useEffect(() => {
    mapViewportRef.current = mapViewport;
  }, [mapViewport]);

  const scheduleH3Refresh = useCallback(() => {
    const viewport = mapViewportRef.current;
    if (!viewport?.bbox || !Number.isFinite(Number(viewport?.zoom))) {
      return;
    }

    const now = Date.now();
    if (now - h3SocketRefreshLastAtRef.current < H3_SOCKET_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    h3SocketRefreshLastAtRef.current = now;

    if (h3SocketRefreshTimerRef.current) {
      clearTimeout(h3SocketRefreshTimerRef.current);
    }

    h3SocketRefreshTimerRef.current = setTimeout(() => {
      setH3RefreshNonce((current) => current + 1);
      h3SocketRefreshTimerRef.current = null;
    }, H3_SOCKET_REFRESH_DEBOUNCE_MS);
  }, []);

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
        setH3LastUpdatedAt(new Date().toISOString());
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
    let active = true;
    const onWsConnect = () => {
      if (active) setWsStatus("conectado");
    };
    const onWsDisconnect = (reason) => {
      if (!active) return;
      if (reason === "io client disconnect") {
        setWsStatus("desconectado");
        return;
      }
      setWsStatus("reconectando");
    };
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
    };

    const onH3Refresh = () => {
      scheduleH3Refresh();
    };

    const onAuthError = () => {
      if (active) setWsStatus("auth-erro");
    };
    const onLegacyAuthError = () => {
      if (active) setWsStatus("auth-erro");
    };
    const onConnectError = () => {
      if (active) setWsStatus("erro");
    };
    const onReconnectAttempt = () => {
      if (active) setWsStatus("reconectando");
    };
    const onReconnectFailed = () => {
      if (active) setWsStatus("erro");
    };

    wsService.on("live_stats", onLiveStats);
    wsService.on("live_stats_update", onLiveStats);
    wsService.on("driver_location_update", onDrivers);
    wsService.on("trip_update", onTrips);
    wsService.on("map_h3_refresh", onH3Refresh);
    wsService.on("authentication_error", onAuthError);
    wsService.on("auth_error", onLegacyAuthError);
    wsService.on("connect_error", onConnectError);
    wsService.on("reconnect_attempt", onReconnectAttempt);
    wsService.on("reconnect_failed", onReconnectFailed);
    wsService.on("connect", onWsConnect);
    wsService.on("disconnect", onWsDisconnect);

    setWsStatus("conectando");
    wsService
      .connect({ namespace: "/dashboard" })
      .then(() => {
        if (!active) return;
        setWsStatus("conectado");
        wsService.emit("request_live_data");
      })
      .catch((error) => {
        if (!active) return;
        setWsStatus(error?.message?.includes("token") ? "sem-token" : "erro");
      });

    return () => {
      active = false;
      wsService.off("live_stats", onLiveStats);
      wsService.off("live_stats_update", onLiveStats);
      wsService.off("driver_location_update", onDrivers);
      wsService.off("trip_update", onTrips);
      wsService.off("map_h3_refresh", onH3Refresh);
      wsService.off("authentication_error", onAuthError);
      wsService.off("auth_error", onLegacyAuthError);
      wsService.off("connect_error", onConnectError);
      wsService.off("reconnect_attempt", onReconnectAttempt);
      wsService.off("reconnect_failed", onReconnectFailed);
      wsService.off("connect", onWsConnect);
      wsService.off("disconnect", onWsDisconnect);
      wsService.disconnect();
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

  const geofenceDraftParsed = useMemo(() => parseRegionDraft(geofenceRegionDraft), [geofenceRegionDraft]);
  const geofenceRegionForMap = useMemo(() => {
    if (Array.isArray(geofenceDraftParsed)) {
      return geofenceDraftParsed;
    }
    return Array.isArray(geoConfig?.geofence?.region) ? geoConfig.geofence.region : [];
  }, [geoConfig?.geofence?.region, geofenceDraftParsed]);
  const geofenceDraftInvalid = geofenceRegionDraft.trim().length > 0 && geofenceDraftParsed === null;
  const selectedStateCapacity = useMemo(
    () => (selectedState?.cities || []).reduce((sum, city) => sum + Number(city?.maxActiveDrivers || 0), 0),
    [selectedState],
  );

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

  const handleGeofenceMapChange = useCallback((nextRegion) => {
    const nextDraft = formatRegionDraft(nextRegion);
    setGeofenceRegionDraft((previous) => (previous === nextDraft ? previous : nextDraft));
  }, []);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Mapas e Geofence</h1>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando dados de mapa..." /> : null}

        <section className="grid">
          <Panel
            className="panel-span-full map-main-panel"
            title="Mapa Operacional e Geofence"
            subtitle="Visual principal da operação com edição de geofence direto no mapa."
          >
            {geoLoading ? <p>Carregando configuração geográfica...</p> : null}

            <div className="filters">
              <span className={wsStatus === "conectado" ? "status-ok" : "status-warn"}>WS: {wsStatus}</span>
              <span className={geoConfig?.geofence?.active ? "status-ok" : "status-warn"}>
                Geofence runtime: {geoConfig?.geofence?.active ? "ativo" : "inativo"}
              </span>
              <span className={geoConfig?.geofence?.enabled !== false ? "status-ok" : "status-warn"}>
                Configuração: {geoConfig?.geofence?.enabled !== false ? "habilitada" : "desabilitada"}
              </span>
              <span className={geoConfig?.geofence?.bypassEnabled ? "status-warn" : "status-ok"}>
                Bypass: {geoConfig?.geofence?.bypassEnabled ? "ligado" : "desligado"}
              </span>
              <span className="meta-badge">Pontos: {geoConfig?.geofence?.regionPoints || 0}</span>
              <span className="meta-badge">Storage geofence: {geoConfig?.geofenceStorage || "-"}</span>
            </div>

            <div className="filters">
              <button onClick={refreshMapLocations}>Atualizar mapa</button>
              <button onClick={loadGeoConfig}>Atualizar geografia</button>
              <button onClick={toggleGeofenceEnabled} disabled={geoLoading || geofenceBusy}>
                {geoConfig?.geofence?.enabled !== false ? "Desativar geofence" : "Ativar geofence"}
              </button>
              <button onClick={saveGeofenceRegion} disabled={geoLoading || geofenceBusy}>
                Salvar geofence
              </button>
              <button onClick={resetGeofenceDraft} disabled={geoLoading || geofenceBusy}>
                Reverter rascunho
              </button>
            </div>

            <GoogleDriversMap
              drivers={locations?.locations?.drivers || []}
              h3Cells={h3Cells}
              h3Loading={h3Loading}
              h3Error={h3Error}
              h3LastUpdatedAt={h3LastUpdatedAt}
              onViewportChange={handleMapViewportChange}
              mapHeight="clamp(700px, 84vh, 1120px)"
              geofenceRegion={geofenceRegionForMap}
              geofenceEditable
              onGeofenceChange={handleGeofenceMapChange}
            />

            <details className="technical-details">
              <summary>Editar geofence em JSON (opcional)</summary>
              <div style={{ padding: "12px" }}>
                <textarea
                  id="geofence-region-draft"
                  value={geofenceRegionDraft}
                  onChange={(event) => setGeofenceRegionDraft(event.target.value)}
                  rows={8}
                  style={{ width: "100%", resize: "vertical", fontFamily: "monospace" }}
                  placeholder='[[-43.8,-23.1],[-43.1,-23.1],[-43.1,-22.7],[-43.8,-22.7],[-43.8,-23.1]]'
                />
                <small style={{ color: "#64748b" }}>
                  O método recomendado é editar direto no mapa; use JSON só para ajustes finos.
                </small>
                {geofenceDraftInvalid ? (
                  <small style={{ display: "block", color: "#b91c1c", marginTop: 6 }}>
                    JSON inválido. Ajuste o formato para habilitar visualização no mapa.
                  </small>
                ) : null}
              </div>
            </details>
          </Panel>
        </section>

        <section className="grid grid-kpi">
          <KpiCard title="Motoristas" value={locations?.summary?.totalDrivers || 0} />
          <KpiCard title="Disponíveis" value={locations?.summary?.availableDrivers || 0} tone="positive" />
          <KpiCard title="Passageiros ativos" value={locations?.summary?.activePassengers || 0} />
          <KpiCard title="Corridas ativas" value={locations?.summary?.activeBookings || 0} />
        </section>

        <section className="grid">
          <Panel
            className="panel-span-full"
            title="Controle Geografico (Geofence + Cidades)"
            subtitle="Gestão condensada de estados e cidades para operação."
          >
            <div className="filters">
              <span className="meta-badge">Estado: {selectedState?.stateCode || selectedStateCode}</span>
              <span className="meta-badge">Cidades ativas: {selectedState?.activeCities || 0}</span>
              <span className="meta-badge">Total cidades: {selectedState?.totalCities || 0}</span>
              <span className="meta-badge">Capacidade estado: {selectedStateCapacity}</span>
              <span className="meta-badge">Storage cidades: {geoConfig?.storage || "-"}</span>
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
                    <th>Status</th>
                    <th>Capacidade</th>
                    <th>Waitlist</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCities.map((city) => (
                    <tr key={city.key}>
                      <td>
                        {city.label || city.name || "-"}
                        <span className="table-muted">{city.value || city.key || "-"}</span>
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
                      <td colSpan={5}>Nenhuma cidade cadastrada para este estado.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <TechnicalDetails
              title="Debug técnico (opcional)"
              data={{
                geofence: geoConfig?.geofence || {},
                cityActivationSummary: geoConfig?.cityActivation?.summary || {},
                selectedState: selectedState || {},
              }}
            />
          </Panel>
        </section>
        <ErrorText message={allErrors} />
      </main>
    </ProtectedRoute>
  );
}
