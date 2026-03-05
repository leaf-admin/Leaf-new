"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

export default function WaitlistPage() {
  const [drivers, setDrivers] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) setLoading(true);
        const [listData, statsData] = await Promise.all([
          leafAPI.getWaitlist(page, 20, status),
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
  }, [page, status]);

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
          </div>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando waitlist..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Waitlist" value={stats?.waitlistCount || 0} />
          <KpiCard title="Página atual" value={pagination?.page || page} />
          <KpiCard title="Total páginas" value={pagination?.pages || 1} />
          <KpiCard title="Status" value={status} />
        </section>

        <section className="grid">
          <Panel title="Stats">
            <pre>{JSON.stringify(stats || {}, null, 2)}</pre>
          </Panel>
          <Panel title="Motoristas">
            <table className="table">
              <thead>
                <tr>
                  <th>Posição</th>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Prioridade</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((item) => (
                  <tr key={item.id}>
                    <td>{item.position ?? "-"}</td>
                    <td>{`${item?.driver?.firstName || ""} ${item?.driver?.lastName || ""}`.trim() || "-"}</td>
                    <td>{item?.driver?.email || "-"}</td>
                    <td>{item.status || "-"}</td>
                    <td>{item.priority || "normal"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
