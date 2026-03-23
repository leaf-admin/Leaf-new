"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

export default function WaitlistPage() {
  const [drivers, setDrivers] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [status, setStatus] = useState("pending");
  const [cityFilter, setCityFilter] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const filteredDrivers = useMemo(() => {
    const term = driverSearch.trim().toLowerCase();
    if (!term) return drivers;
    return drivers.filter((item) =>
      `${item?.id || ""} ${item?.cityLabel || item?.cityKey || ""} ${item?.driver?.firstName || ""} ${item?.driver?.lastName || ""} ${item?.driver?.email || ""} ${item?.status || ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [drivers, driverSearch]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) setLoading(true);
        const [listData, statsData] = await Promise.all([
          leafAPI.getWaitlist(page, 20, status, cityFilter),
          leafAPI.getWaitlistStats(),
        ]);
        if (!mounted) return;
        setDrivers(listData?.drivers || []);
        setPagination(listData?.pagination || null);
        setStats(statsData);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar waitlist");
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
  }, [page, status, cityFilter]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Waitlist</h1>
          <div className="filters">
            <select
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovados</option>
              <option value="rejected">Rejeitados</option>
            </select>
            <input
              placeholder="Filtro por cidade (slug)"
              value={cityFilter}
              onChange={(e) => {
                setPage(1);
                setCityFilter(e.target.value);
              }}
            />
          </div>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando waitlist..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Pendentes" value={stats?.stats?.pending || 0} />
          <KpiCard title="Aprovados" value={stats?.stats?.approved || 0} />
          <KpiCard title="Página atual" value={pagination?.page || page} />
          <KpiCard title="Slots disponíveis" value={stats?.stats?.availableSlots || 0} />
        </section>

        <section className="grid">
          <Panel
            title="Stats gerais"
            subtitle="Painel resumido de capacidade, pendências e distribuição por cidade."
          >
            <KeyValueGrid
              data={{
                pending: stats?.stats?.pending || 0,
                approved: stats?.stats?.approved || 0,
                rejected: stats?.stats?.rejected || 0,
                availableSlots: stats?.stats?.availableSlots || 0,
                totalCities: (stats?.byCity || []).length,
                currentPage: pagination?.page || page,
              }}
              labels={{
                pending: "Pendentes",
                approved: "Aprovados",
                rejected: "Rejeitados",
                availableSlots: "Slots disponiveis",
                totalCities: "Cidades monitoradas",
                currentPage: "Pagina atual",
              }}
            />
            <TechnicalDetails title="Ver payload técnico da waitlist" data={stats || {}} />
          </Panel>
          <Panel title="Capacidade por Cidade" subtitle="Leitura de oferta por UF/cidade para gestão de abertura.">
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Cidade</th>
                    <th>UF</th>
                    <th>Pendentes</th>
                    <th>Aprovados</th>
                    <th>Rejeitados</th>
                    <th>Capacidade</th>
                    <th>Slots</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.byCity || []).map((city) => (
                    <tr key={city.cityKey}>
                      <td>{city.cityLabel || city.cityKey}</td>
                      <td>{city.stateCode || "-"}</td>
                      <td>{city.pending || 0}</td>
                      <td>{city.approved || 0}</td>
                      <td>{city.rejected || 0}</td>
                      <td>{city.maxActiveDrivers || 0}</td>
                      <td>{city.availableSlots || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Motoristas" subtitle="Fila operacional por cidade e prioridade de ativação.">
            <div className="filters">
              <input
                placeholder="Filtrar por nome, e-mail ou cidade"
                value={driverSearch}
                onChange={(e) => setDriverSearch(e.target.value)}
              />
            </div>
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Posição</th>
                    <th>Cidade</th>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Prioridade</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Nenhum motorista na waitlist para este filtro.</td>
                    </tr>
                  ) : (
                    filteredDrivers.map((item) => (
                      <tr key={item.id}>
                        <td>{item.position ?? "-"}</td>
                        <td>{item.cityLabel || item.cityKey || "-"}</td>
                        <td>
                          {`${item?.driver?.firstName || ""} ${item?.driver?.lastName || ""}`.trim() || "-"}
                        </td>
                        <td>{item?.driver?.email || "-"}</td>
                        <td>
                          <span className={item.status === "approved" ? "status-ok" : "status-warn"}>
                            {item.status || "-"}
                          </span>
                        </td>
                        <td>{item.priority || "normal"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
              <span>Página {pagination?.page || page}</span>
              <button onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
