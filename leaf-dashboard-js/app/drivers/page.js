"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import {
  DRIVER_TABS,
  classifyDriver,
  countByTab,
  matchesSearch,
  resolveDriverHeadline,
  resolveDriverSteps,
} from "@/src/utils/driver-review";

const DRIVERS_REFRESH_MS = 60000;
const PAGE_LIMIT = 200;
const TAB_TONES = { review: "warning", onboarding: "default", approved: "positive", rejected: "danger", all: "default" };
const TAB_HINTS = {
  review: "Precisam de uma decisão sua",
  onboarding: "Ainda enviando documentos",
  approved: "Podem ficar online",
  rejected: "Recusados ou bloqueados",
  all: "Todos os cadastros",
};

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || "?"}${parts[1]?.[0] || ""}`.toUpperCase();
}

function formatDate(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function StepDots({ steps }) {
  return (
    <div className="driver-steps" aria-label={steps.map((step) => `${step.title}: ${step.label}`).join(", ")}>
      {steps.map((step) => (
        <span key={step.key} className={`driver-step-dot driver-step-${step.tone}`} title={`${step.title}: ${step.label}`} />
      ))}
    </div>
  );
}

function DriversPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kycScope = String(searchParams.get("kycScope") || "").trim().toLowerCase() === "sandbox" ? "sandbox" : "operational";
  const kycRequestContext = useMemo(() => ({ scope: kycScope }), [kycScope]);
  const requestedTab = String(searchParams.get("tab") || "review");
  const tab = DRIVER_TABS.some((item) => item.id === requestedTab) ? requestedTab : "review";
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await leafAPI.getDrivers(1, PAGE_LIMIT, "all", "", kycRequestContext);
      setApplications(Array.isArray(response?.applications) ? response.applications : []);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar os motoristas.");
    } finally {
      setLoading(false);
    }
  }, [kycRequestContext]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) load();
    }, DRIVERS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => countByTab(applications), [applications]);
  const rows = useMemo(
    () => applications
      .filter((item) => tab === "all" || classifyDriver(item) === tab)
      .filter((item) => matchesSearch(item, search)),
    [applications, search, tab],
  );

  const scopeQuery = kycScope === "sandbox" ? "&kycScope=sandbox" : "";
  const selectTab = (nextTab) => router.replace(`/drivers?tab=${nextTab}${scopeQuery}`, { scroll: false });
  const detailHref = (id) => `/drivers/${encodeURIComponent(id)}${kycScope === "sandbox" ? "?kycScope=sandbox" : ""}`;

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Motoristas</h1>
            <p className="muted">Quem passa em todas as regras é aprovado sozinho. Aqui ficam só as decisões que precisam de você.</p>
          </div>
          <div className="filters">
            <input
              type="search"
              placeholder="Buscar por nome, telefone, CPF ou placa"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar motorista"
            />
            <Link href={kycScope === "sandbox" ? "/drivers" : "/drivers?kycScope=sandbox"}>
              {kycScope === "sandbox" ? "Voltar ao operacional" : "Ver sandbox"}
            </Link>
          </div>
        </header>

        <AppNav />

        <section className="grid grid-kpi" role="tablist" aria-label="Situação do cadastro">
          {DRIVER_TABS.filter((item) => item.id !== "all").map((item) => (
            <KpiCard
              key={item.id}
              title={item.label}
              value={loading ? "…" : counts[item.id]}
              subtitle={TAB_HINTS[item.id]}
              tone={TAB_TONES[item.id]}
              selected={tab === item.id}
              onClick={() => selectTab(item.id)}
            />
          ))}
        </section>

        <section className="grid">
          <Panel
            className="panel-span-full"
            title={DRIVER_TABS.find((item) => item.id === tab)?.label || "Motoristas"}
            subtitle={TAB_HINTS[tab]}
            actions={tab === "all" ? null : <button type="button" className="button-secondary" onClick={() => selectTab("all")}>Ver todos ({counts.all})</button>}
          >
            {loading ? <LoadingState message="Carregando motoristas..." /> : null}
            {!loading && rows.length === 0 ? (
              <p className="driver-empty">
                {tab === "review" ? "Nenhuma decisão pendente. Bom trabalho." : "Nenhum motorista nesta lista."}
              </p>
            ) : null}
            {rows.length > 0 ? (
              <ul className="driver-list">
                {rows.map((item) => {
                  const id = item.id || item.driver?.id;
                  const steps = resolveDriverSteps(item);
                  const bucket = classifyDriver(item);
                  const vehicle = item.vehicleConfig || {};
                  return (
                    <li key={id}>
                      <Link href={detailHref(id)} className="driver-row" data-testid={`driver-row-${id}`}>
                        <span className="driver-avatar" aria-hidden="true">{initials(item.driver?.name)}</span>
                        <span className="driver-main">
                          <strong>{item.driver?.name || "Sem nome"}</strong>
                          <span className="table-muted">{item.driver?.phone || "-"}{vehicle.activeVehiclePlate ? ` · ${vehicle.activeVehiclePlate}` : ""}</span>
                        </span>
                        <StepDots steps={steps} />
                        <span className={`driver-headline driver-headline-${bucket}`}>{resolveDriverHeadline(item)}</span>
                        <span className="table-muted driver-date">{formatDate(item.submissionDate)}</span>
                        <span className="driver-open" aria-hidden="true">›</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}

export default function DriversPage() {
  return (
    <Suspense fallback={<LoadingState message="Carregando motoristas..." />}>
      <DriversPageContent />
    </Suspense>
  );
}
