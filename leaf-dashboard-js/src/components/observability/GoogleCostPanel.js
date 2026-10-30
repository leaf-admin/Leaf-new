"use client";

import { useEffect, useState } from "react";
import Panel from "@/src/components/ui/Panel";
import { leafAPI } from "@/src/services/api";

// O monitor grava a cada 2 min e o Google atrasa 3 a 5 min: 1 min de refresh basta.
const REFRESH_MS = 60 * 1000;

const LABELS = {
  "routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRoutes": "Rotas",
  "geocoding-backend.googleapis.com|google.places.Geocoding.Http": "Endereço por coordenada",
  "places-backend.googleapis.com|google.places.Autocomplete.Http": "Busca de endereço",
  "places-backend.googleapis.com|google.places.Details.Http": "Detalhe do lugar",
  "directions-backend.googleapis.com|google.routes.Directions.Http": "Directions (legado)",
  "maps-android-backend.googleapis.com|google.maps.BaseMap.Android": "Mapa Android (grátis)",
  "maps-ios-backend.googleapis.com|google.maps.BaseMap.IOS": "Mapa iOS (grátis)",
  "maps-backend.googleapis.com|google.maps.BaseMap.Javascript": "Mapa web (dashboard)",
  "firestore|read": "Firestore: leituras",
  "firestore|write": "Firestore: gravações",
  "firestore|delete": "Firestore: exclusões",
};

const usd = (value, digits = 2) =>
  value == null ? "-" : `US$ ${Number(value).toFixed(digits).replace(".", ",")}`;
const count = (value) => Number(value || 0).toLocaleString("pt-BR");
const label = (field) => LABELS[field] || field.split("|").pop();

function Tile({ title, window }) {
  return (
    <article className="ops-stat">
      <span>{title}</span>
      <strong>{usd(window?.costUsd)}</strong>
      <small>
        {count(window?.rides)} corrida(s)
        {window?.costPerRideUsd != null ? ` · ${usd(window.costPerRideUsd, 3)} por corrida` : ""}
      </small>
    </article>
  );
}

export default function GoogleCostPanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await leafAPI.getGoogleCost();
        if (!mounted) return;
        setSnapshot(data);
        setError("");
      } catch (loadError) {
        if (mounted) setError(loadError?.message || "erro");
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const day = snapshot?.windows?.["24h"];
  const hours = (snapshot?.hourly || []).slice(-12).reverse();

  return (
    <Panel
      title="Custo Google e Firestore"
      subtitle="Contado pelo próprio Google, a preço de tabela e sem a cota grátis. Atraso de 3 a 5 min."
      className="panel-span-full"
    >
      {error ? <p className="status-warn">Indisponível agora ({error}).</p> : null}
      <div className="ops-stat-grid">
        <Tile title="Última hora" window={snapshot?.windows?.["1h"]} />
        <Tile title="Últimas 24 h" window={day} />
        <Tile title="Últimos 7 dias" window={snapshot?.windows?.["7d"]} />
        <article className="ops-stat">
          <span>Rotas por corrida (24 h)</span>
          <strong>{day?.routesPerRide == null ? "-" : day.routesPerRide.toFixed(1).replace(".", ",")}</strong>
          <small>esperado: 2</small>
        </article>
      </div>
      <div className="ops-rows">
        {(day?.items || []).slice(0, 8).map((item) => (
          <div key={item.field} className="ops-row">
            <span>{label(item.field)}</span>
            <strong>{usd(item.costUsd, 3)}</strong>
            <small>{count(item.count)} chamada(s) em 24 h</small>
          </div>
        ))}
        {day && day.items.length === 0 ? <p className="text-muted">Nenhuma chamada paga em 24 h.</p> : null}
      </div>
      <div className="ops-rows">
        {hours.map((hour) => (
          <div key={hour.hour} className="ops-row">
            <span>{new Date(hour.hour).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            <strong>{usd(hour.costUsd, 3)}</strong>
            <small>{count(hour.rides)} corrida(s)</small>
          </div>
        ))}
      </div>
    </Panel>
  );
}
