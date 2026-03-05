"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const statusTone = {
  active: "status-ok",
  approved: "status-ok",
  pending: "status-warn",
  inactive: "status-warn",
  blocked: "status-bad",
  rejected: "status-bad",
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [type, setType] = useState("all");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }
        const params = {
          page,
          limit: 20,
          searchTerm: searchTerm || undefined,
          type: type === "all" ? undefined : type,
        };
        const response = await leafAPI.getUsers(params);
        if (mounted) setUsers(response?.users || []);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar usuarios");
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
  }, [page, searchTerm, type]);

  const summary = useMemo(() => {
    const base = {
      total: users.length,
      drivers: 0,
      customers: 0,
      active: 0,
      pending: 0,
    };
    users.forEach((user) => {
      const userType = String(user?.type || user?.usertype || "").toLowerCase();
      const status = String(user?.status || "").toLowerCase();
      if (userType === "driver") base.drivers += 1;
      if (userType === "customer") base.customers += 1;
      if (status === "active" || status === "approved") base.active += 1;
      if (status === "pending" || status === "analyzing") base.pending += 1;
    });
    return base;
  }, [users]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Usuarios</h1>
          <div className="filters">
            <input
              placeholder="buscar..."
              value={searchTerm}
              onChange={(e) => {
                setPage(1);
                setSearchTerm(e.target.value);
              }}
            />
            <select
              value={type}
              onChange={(e) => {
                setPage(1);
                setType(e.target.value);
              }}
            >
              <option value="all">Todos</option>
              <option value="driver">Motoristas</option>
              <option value="customer">Clientes</option>
            </select>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando usuarios..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Lista atual" value={summary.total} />
          <KpiCard title="Motoristas" value={summary.drivers} />
          <KpiCard title="Clientes" value={summary.customers} />
          <KpiCard title="Ativos" value={summary.active} tone="positive" />
          <KpiCard title="Pendentes" value={summary.pending} tone="warning" />
        </section>

        <section className="grid">
          <Panel title="Usuarios">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, idx) => {
                  const userId = user.id || user.uid;
                  const userType = String(user.type || user.usertype || "-").toLowerCase();
                  const userStatus = String(user.status || "-").toLowerCase();
                  const badgeClass = statusTone[userStatus] || "status-warn";

                  return (
                    <tr key={userId || `u-${idx}`}>
                      <td>{user.name || user.displayName || "-"}</td>
                      <td>{user.email || "-"}</td>
                      <td>{userType}</td>
                      <td>
                        <span className={badgeClass}>{userStatus}</span>
                      </td>
                      <td>
                        <div className="filters">
                          {userId ? <Link href={`/users/${userId}`}>Detalhes</Link> : null}
                          {userType === "driver" && userId ? (
                            <Link href={`/drivers/${userId}/documents`}>Documentos</Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="pager">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
              <span>Pagina {page}</span>
              <button onClick={() => setPage((p) => p + 1)}>Proxima</button>
            </div>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
