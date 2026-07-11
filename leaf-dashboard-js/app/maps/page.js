"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import LeafOperationsMap from "@/src/components/map/LeafOperationsMap";
import { TechnicalDetails } from "@/src/components/ui/DataViews";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";

const H3_VIEWPORT_DEBOUNCE_MS = 400;

function formatRegionDraft(region) {
  if (!Array.isArray(region)) return "[]";
  return JSON.stringify(region, null, 2);
}

function normalizeCoordinatePoint(point) {
  const lng = Array.isArray(point) ? Number(point[0]) : Number(point?.lng);
  const lat = Array.isArray(point) ? Number(point[1]) : Number(point?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function isCoordinatePair(point) {
  return normalizeCoordinatePoint(point) !== null;
}

function normalizeRegionRing(points) {
  if (!Array.isArray(points) || points.length < 3 || !points.every(isCoordinatePair)) return null;
  const normalized = points.map(normalizeCoordinatePoint);
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    normalized.push([first[0], first[1]]);
  }
  return normalized;
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

  if (parsed.every(isCoordinatePair)) {
    return normalizeRegionRing(parsed);
  }

  const rings = parsed.map(normalizeRegionRing);
  return rings.every(Boolean) ? rings : null;
}

function parseRegionPayload(regionDraft) {
  const parsed = parseRegionDraft(regionDraft);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (parsed.every(isCoordinatePair)) return parsed.length >= 4 ? parsed : null;
  return parsed.every((ring) => Array.isArray(ring) && ring.length >= 4) ? parsed : null;
}

function getRegionPointCount(region) {
  if (!Array.isArray(region)) return 0;
  if (region.every(isCoordinatePair)) return region.length;
  return region.reduce((total, ring) => total + (Array.isArray(ring) ? ring.length : 0), 0);
}

function getRegionAreaCount(region) {
  if (!Array.isArray(region) || region.length === 0) return 0;
  return region.every(isCoordinatePair) ? 1 : region.filter(Array.isArray).length;
}

function getConfiguredRegionPointCount(geofence) {
  const reportedCount = Number(geofence?.regionPoints);
  return Number.isFinite(reportedCount) ? reportedCount : getRegionPointCount(geofence?.region);
}

function formatTimeLabel(isoDate) {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("pt-BR", { hour12: false });
}

function getH3StatusMeta({ loading, error, lastUpdatedAt }) {
  if (error) return { className: "status-bad", label: "erro" };
  if (loading) return { className: "status-warn", label: "atualizando" };
  const timeLabel = formatTimeLabel(lastUpdatedAt);
  if (!timeLabel) return { className: "status-warn", label: "aguardando" };
  return { className: "status-ok", label: `ok (${timeLabel})` };
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
  const [geoLoading, setGeoLoading] = useState(true);
  const [geoError, setGeoError] = useState("");
  const [geoConfig, setGeoConfig] = useState(null);
  const [selectedStateCode, setSelectedStateCode] = useState("RJ");
  const [stateBusy, setStateBusy] = useState(false);
  const [cityBusyKey, setCityBusyKey] = useState("");
  const [newCityName, setNewCityName] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [cityFilterMode, setCityFilterMode] = useState("all");
  const [cityCapDraft, setCityCapDraft] = useState({});
  const [cityWaitlistDraft, setCityWaitlistDraft] = useState({});
  const [geofenceBusy, setGeofenceBusy] = useState(false);
  const [geofenceEnabledDraft, setGeofenceEnabledDraft] = useState(true);
  const [geofenceRegionDraft, setGeofenceRegionDraft] = useState("[]");
  const [isGeofenceEditing, setIsGeofenceEditing] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const h3ViewportRequestRef = useRef("");
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
    const parsedRegion = parseRegionPayload(geofenceRegionDraft);
    if (!parsedRegion) {
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
      setIsGeofenceEditing(false);
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
    const withModeFilter =
      cityFilterMode === "all"
        ? cities
        : cities.filter((city) => (cityFilterMode === "active" ? city?.active : !city?.active));
    if (!term) return withModeFilter;
    return withModeFilter.filter((city) =>
      `${city?.label || city?.name || ""} ${city?.value || city?.key || ""}`.toLowerCase().includes(term),
    );
  }, [cityFilterMode, selectedState, citySearch]);

  const geofenceDraftParsed = useMemo(() => parseRegionDraft(geofenceRegionDraft), [geofenceRegionDraft]);
  const geofenceDraftReady = parseRegionPayload(geofenceRegionDraft) !== null;
  const geofenceRegionForMap = useMemo(() => {
    if (isGeofenceEditing && Array.isArray(geofenceDraftParsed)) {
      return geofenceDraftParsed;
    }
    return Array.isArray(geoConfig?.geofence?.region) ? geoConfig.geofence.region : [];
  }, [geoConfig?.geofence?.region, geofenceDraftParsed, isGeofenceEditing]);
  const geofenceDraftInvalid = geofenceRegionDraft.trim().length > 0 && geofenceDraftParsed === null;
  const selectedStateCapacity = useMemo(
    () => (selectedState?.cities || []).reduce((sum, city) => sum + Number(city?.maxActiveDrivers || 0), 0),
    [selectedState],
  );
  const selectedStateTotalCities = Number(selectedState?.totalCities || selectedState?.cities?.length || 0);
  const selectedStateActiveCities = Number(selectedState?.activeCities || 0);
  const selectedStateInactiveCities = Math.max(selectedStateTotalCities - selectedStateActiveCities, 0);
  const selectedStateWaitlistCities = useMemo(() => {
    const cities = selectedState?.cities || [];
    return cities.filter((city) => cityWaitlistDraft[city.key] ?? city.waitlistEnabled !== false).length;
  }, [cityWaitlistDraft, selectedState]);
  const h3StatusMeta = useMemo(
    () =>
      getH3StatusMeta({
        loading: h3Loading,
        error: h3Error,
        lastUpdatedAt: h3LastUpdatedAt,
      }),
    [h3Error, h3LastUpdatedAt, h3Loading],
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
      const [response] = await Promise.all([leafAPI.getMapLocations("all"), loadGeoConfig()]);
      setLocations(response);
      setH3RefreshNonce((current) => current + 1);
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

  const beginGeofenceEditing = () => {
    resetGeofenceDraft();
    setIsGeofenceEditing(true);
  };

  const cancelGeofenceEditing = () => {
    if (geofenceBusy) return;
    resetGeofenceDraft();
    setIsGeofenceEditing(false);
  };

  const requestGeofencePublish = () => {
    const nextRegion = parseRegionPayload(geofenceRegionDraft);
    if (!nextRegion) {
      setGeoError("Poligono invalido. Use JSON no formato [[lng,lat], ...].");
      return;
    }

    const currentEnabled = geoConfig?.geofence?.enabled !== false;
    const currentPointCount = getConfiguredRegionPointCount(geoConfig?.geofence);

    setPendingConfirmation({
      title: "Publicar nova região da geofence?",
      description: "Revise a alteração antes de substituir a região operacional publicada.",
      confirmLabel: "Publicar região",
      tone: "warning",
      details: [
        { label: "Estado atual", value: currentEnabled ? "Habilitada" : "Desabilitada" },
        { label: "Novo estado", value: geofenceEnabledDraft ? "Habilitada" : "Desabilitada" },
        { label: "Polígono atual", value: `${currentPointCount} ponto(s)` },
        { label: "Áreas no rascunho", value: String(getRegionAreaCount(nextRegion)) },
        { label: "Novo polígono", value: `${getRegionPointCount(nextRegion)} ponto(s)` },
      ],
      consequence:
        "O polígono persistido será substituído e a configuração enabled será mantida conforme o rascunho atual.",
      execute: saveGeofenceRegion,
    });
  };

  const requestGeofenceToggle = () => {
    const currentEnabled = geoConfig?.geofence?.enabled !== false;
    const nextEnabled = !currentEnabled;
    setPendingConfirmation({
      title: `${nextEnabled ? "Ativar" : "Desativar"} geofence?`,
      description: "Confirme a mudança do controle geográfico global.",
      confirmLabel: nextEnabled ? "Ativar geofence" : "Desativar geofence",
      tone: nextEnabled ? "warning" : "danger",
      details: [
        { label: "Estado atual", value: currentEnabled ? "Habilitada" : "Desabilitada" },
        { label: "Novo estado", value: nextEnabled ? "Habilitada" : "Desabilitada" },
        {
          label: "Polígono publicado",
          value: `${getConfiguredRegionPointCount(geoConfig?.geofence)} ponto(s)`,
        },
      ],
      consequence: "O backend passará a considerar o novo valor de enabled na política geográfica existente.",
      execute: toggleGeofenceEnabled,
    });
  };

  const requestStateToggle = () => {
    if (!selectedState) return;
    const nextEnabled = !selectedState.enabled;
    setPendingConfirmation({
      title: `${nextEnabled ? "Ativar" : "Desativar"} ${selectedState.name || selectedState.stateCode}?`,
      description: "Revise o estado selecionado antes de alterar sua ativação.",
      confirmLabel: nextEnabled ? "Ativar estado" : "Desativar estado",
      tone: nextEnabled ? "warning" : "danger",
      details: [
        { label: "Estado", value: `${selectedState.name || "-"} (${selectedState.stateCode})` },
        { label: "Estado atual", value: selectedState.enabled ? "Ativo" : "Inativo" },
        { label: "Novo estado", value: nextEnabled ? "Ativo" : "Inativo" },
        { label: "Cidades vinculadas", value: String(selectedStateTotalCities) },
      ],
      consequence: "A ativação do estado será atualizada no catálogo geográfico usado pelo backend.",
      execute: toggleStateActivation,
    });
  };

  const requestCityToggle = (city) => {
    if (!selectedState || !city?.key) return;
    const nextActive = !city.active;
    const cityLabel = city.label || city.name || city.value || city.key;
    setPendingConfirmation({
      title: `${nextActive ? "Ativar" : "Desativar"} ${cityLabel}?`,
      description: "Confirme a mudança desta cidade na operação geográfica.",
      confirmLabel: nextActive ? "Ativar cidade" : "Desativar cidade",
      tone: nextActive ? "warning" : "danger",
      details: [
        { label: "Estado", value: selectedState.stateCode },
        { label: "Cidade", value: cityLabel },
        { label: "Estado atual", value: city.active ? "Ativa" : "Inativa" },
        { label: "Novo estado", value: nextActive ? "Ativa" : "Inativa" },
      ],
      consequence: "O status da cidade será atualizado pela regra geográfica já existente no backend.",
      execute: () => toggleCityActivation(city),
    });
  };

  const closeConfirmation = () => {
    if (!confirmationBusy) setPendingConfirmation(null);
  };

  const confirmPendingAction = async () => {
    if (!pendingConfirmation?.execute || confirmationBusy) return;

    const action = pendingConfirmation;
    try {
      setConfirmationBusy(true);
      await action.execute();
    } finally {
      setConfirmationBusy(false);
      setPendingConfirmation((current) => (current === action ? null : current));
    }
  };

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
            subtitle="Mapa principal com geofence editável, estado de runtime e controles condensados."
          >
            {geoLoading ? <p>Carregando configuração geográfica...</p> : null}

            <div className="map-command-bar">
              <div className="filters">
                <span className={h3StatusMeta.className}>H3: {h3StatusMeta.label}</span>
                <span className={geoConfig?.geofence?.active ? "status-ok" : "status-warn"}>
                  Geofence {geoConfig?.geofence?.active ? "ativa" : "inativa"}
                </span>
                {isGeofenceEditing ? <span className="status-warn">Rascunho em edição</span> : null}
                {isGeofenceEditing && !geofenceDraftReady ? (
                  <span className="meta-badge">Adicione ao menos 3 pontos</span>
                ) : null}
              </div>
              <div className="map-command-actions">
              {isGeofenceEditing ? (
                <>
                  <button
                    className="primary-action"
                    onClick={requestGeofencePublish}
                    disabled={geoLoading || geofenceBusy || !geofenceDraftReady}
                    title={geofenceDraftReady ? "" : "Adicione ao menos 3 pontos para revisar a região"}
                  >
                    Revisar e publicar
                  </button>
                  <button onClick={cancelGeofenceEditing} disabled={geoLoading || geofenceBusy}>
                    Cancelar edição
                  </button>
                </>
              ) : (
                <>
                  <button className="primary-action" onClick={beginGeofenceEditing} disabled={geoLoading || geofenceBusy}>
                    Editar região
                  </button>
                  <details className="map-runtime-disclosure">
                    <summary>Opções</summary>
                    <div>
                      <button onClick={refreshMapLocations}>Atualizar mapa</button>
                      <button onClick={loadGeoConfig}>Atualizar geografia</button>
                      <button onClick={requestGeofenceToggle} disabled={geoLoading || geofenceBusy}>
                        {geoConfig?.geofence?.enabled !== false ? "Desativar geofence" : "Ativar geofence"}
                      </button>
                    </div>
                  </details>
                </>
              )}
              </div>
            </div>

            <details className="map-status-disclosure">
              <summary>Detalhes do runtime geográfico</summary>
              <div className="filters map-status-strip">
                <span className="meta-badge">Atualização: API/polling</span>
                <span className={geoConfig?.geofence?.enabled !== false ? "status-ok" : "status-warn"}>
                  Configuração: {geoConfig?.geofence?.enabled !== false ? "habilitada" : "desabilitada"}
                </span>
                <span className="meta-badge">Pontos: {geoConfig?.geofence?.regionPoints || 0}</span>
                <span className="meta-badge">Storage: {geoConfig?.geofenceStorage || "-"}</span>
                <span className={geoConfig?.geofence?.bypassEnabled ? "status-warn" : "status-ok"}>
                  Bypass: {geoConfig?.geofence?.bypassEnabled ? "ligado" : "desligado"}
                </span>
              </div>
            </details>

            <LeafOperationsMap
              drivers={locations?.locations?.drivers || []}
              h3Cells={h3Cells}
              h3Loading={h3Loading}
              h3Error={h3Error}
              h3LastUpdatedAt={h3LastUpdatedAt}
              onViewportChange={handleMapViewportChange}
              mapHeight="clamp(460px, 58vh, 680px)"
              geofenceRegion={geofenceRegionForMap}
              geofenceEditable={isGeofenceEditing}
              onGeofenceChange={isGeofenceEditing ? handleGeofenceMapChange : undefined}
              showH3SyncLabel={false}
            />

            {isGeofenceEditing ? (
              <details className="technical-details">
                <summary>Editar por coordenadas (alternativa ao mapa)</summary>
                <div style={{ padding: "12px" }}>
                  <label className="geofence-json-editor-label" htmlFor="geofence-region-draft">
                    Coordenadas da geofence em JSON
                  </label>
                  <small id="geofence-region-draft-help" className="geofence-json-editor-help">
                    Alternativa acessível equivalente ao desenho no mapa. Aceita um anel ou uma lista de áreas; cada ponto usa longitude, latitude.
                  </small>
                  <textarea
                    id="geofence-region-draft"
                    aria-describedby="geofence-region-draft-help"
                    value={geofenceRegionDraft}
                    onChange={(event) => setGeofenceRegionDraft(event.target.value)}
                    rows={8}
                    style={{ width: "100%", resize: "vertical", fontFamily: "monospace" }}
                    placeholder='[[-43.8,-23.1],[-43.1,-23.1],[-43.1,-22.7],[-43.8,-22.7],[-43.8,-23.1]]'
                  />
                  {geofenceDraftInvalid ? (
                    <small style={{ display: "block", color: "#b91c1c", marginTop: 6 }}>
                      JSON inválido. Ajuste o formato para habilitar visualização no mapa.
                    </small>
                  ) : null}
                </div>
              </details>
            ) : null}
          </Panel>
        </section>

        <section className="grid grid-kpi">
          <KpiCard title="Motoristas" value={locations?.summary?.totalDrivers || 0} />
          <KpiCard title="Disponíveis" value={locations?.summary?.availableDrivers || 0} tone="positive" />
          <KpiCard title="Passageiros ativos" value={locations?.summary?.activePassengers || 0} />
          <KpiCard title="Corridas ativas" value={locations?.summary?.activeBookings || 0} />
        </section>

        <details className="map-geography-disclosure">
          <summary>
            <span>
              <strong>Território, cidades e capacidade</strong>
              <small>Configuração administrativa separada do mapa operacional.</small>
            </span>
            <span className="meta-badge">{selectedStateTotalCities} cidades</span>
          </summary>
          <section className="grid">
          <Panel
            className="panel-span-full"
            title="Controle Geografico (Geofence + Cidades)"
            subtitle="Operação geográfica em visão compacta e acionável."
          >
            <div className="filters map-status-strip">
              <span className="meta-badge">Estado: {selectedState?.stateCode || selectedStateCode}</span>
              <span className="meta-badge">Ativas: {selectedStateActiveCities}</span>
              <span className="meta-badge">Inativas: {selectedStateInactiveCities}</span>
              <span className="meta-badge">Total: {selectedStateTotalCities}</span>
              <span className="meta-badge">Waitlist ligado: {selectedStateWaitlistCities}</span>
              <span className="meta-badge">Capacidade estado: {selectedStateCapacity}</span>
              <span className="meta-badge">Storage cidades: {geoConfig?.storage || "-"}</span>
            </div>

            <div className="geo-toolbar-grid">
              <label className="geo-toolbar-field">
                <span>Estado</span>
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
              </label>

              <label className="geo-toolbar-field">
                <span>Filtro</span>
                <select value={cityFilterMode} onChange={(event) => setCityFilterMode(event.target.value)}>
                  <option value="all">Todas</option>
                  <option value="active">Apenas ativas</option>
                  <option value="inactive">Apenas inativas</option>
                </select>
              </label>

              <label className="geo-toolbar-field geo-toolbar-field-grow">
                <span>Buscar cidade</span>
                <input
                  placeholder="Nome ou slug"
                  value={citySearch}
                  onChange={(event) => setCitySearch(event.target.value)}
                />
              </label>

              <label className="geo-toolbar-field geo-toolbar-field-grow">
                <span>Nova cidade</span>
                <input
                  placeholder={`Adicionar em ${selectedState?.stateCode || "UF"}`}
                  value={newCityName}
                  onChange={(event) => setNewCityName(event.target.value)}
                />
              </label>

              <div className="geo-toolbar-actions">
                <button
                  onClick={createCity}
                  disabled={!selectedState || newCityName.trim().length < 2 || cityBusyKey === "create-city"}
                >
                  Adicionar cidade
                </button>
                <button onClick={requestStateToggle} disabled={!selectedState || stateBusy}>
                  {selectedState?.enabled ? "Desativar estado" : "Ativar estado"}
                </button>
              </div>
            </div>

            <div className="city-list-shell">
              {filteredCities.map((city) => (
                <article key={city.key} className="city-list-row">
                  <div className="city-row-main">
                    <div>
                      <strong>{city.label || city.name || "-"}</strong>
                      <div className="table-muted">{city.value || city.key || "-"}</div>
                    </div>
                    <span className={city.active ? "status-ok" : "status-warn"}>
                      {city.active ? "Ativa" : "Inativa"}
                    </span>
                  </div>

                  <div className="city-row-controls">
                    <label className="city-row-field">
                      <span>Capacidade</span>
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
                      />
                    </label>
                    <label className="city-row-field city-row-field-checkbox">
                      <span>Waitlist</span>
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
                    </label>
                  </div>

                  <div className="city-row-actions">
                    <button disabled={cityBusyKey === `city-config-${city.key}`} onClick={() => saveCityCapacity(city)}>
                      Salvar
                    </button>
                    <button disabled={cityBusyKey === city.key} onClick={() => requestCityToggle(city)}>
                      {city.active ? "Desativar" : "Ativar"}
                    </button>
                  </div>
                </article>
              ))}
              {!selectedState || filteredCities.length === 0 ? (
                <div className="city-list-empty">Nenhuma cidade para os filtros atuais.</div>
              ) : null}
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
        </details>
        <ErrorText message={allErrors} />
        <ConfirmActionDialog
          open={Boolean(pendingConfirmation)}
          title={pendingConfirmation?.title}
          description={pendingConfirmation?.description}
          confirmLabel={pendingConfirmation?.confirmLabel}
          tone={pendingConfirmation?.tone}
          busy={confirmationBusy}
          onConfirm={confirmPendingAction}
          onCancel={closeConfirmation}
        >
          <div className="confirm-dialog-context">
            {(pendingConfirmation?.details || []).map((detail) => (
              <p key={detail.label} className="confirm-dialog-context-row">
                <strong>{detail.label}:</strong> {detail.value}
              </p>
            ))}
            {pendingConfirmation?.consequence ? (
              <p className="confirm-dialog-consequence">
                <strong>Consequência:</strong> {pendingConfirmation.consequence}
              </p>
            ) : null}
          </div>
        </ConfirmActionDialog>
      </main>
    </ProtectedRoute>
  );
}
