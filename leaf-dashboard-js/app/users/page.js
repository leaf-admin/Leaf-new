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
const USERS_REFRESH_MS = 120000;

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [type, setType] = useState("all");

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setDebouncedSearchTerm(searchTerm);
    }, 350);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }
        const params = {
          page,
          limit: 20,
          searchTerm: debouncedSearchTerm || undefined,
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
    const timer = setInterval(load, USERS_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [debouncedSearchTerm, page, type]);

  const summary = useMemo(() => {
    const base = {
      total: users.length,
      drivers: 0,
      customers: 0,
      pending: 0,
    };
    users.forEach((user) => {
      const userType = String(user?.type || user?.usertype || "").toLowerCase();
      const status = String(user?.status || "").toLowerCase();
      if (userType === "driver") base.drivers += 1;
      if (userType === "customer") base.customers += 1;
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
              aria-label="Buscar usuário"
              placeholder="buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </header>

        <AppNav />
        <details className="users-filter-disclosure">
          <summary>Filtros</summary>
          <div className="filters">
            <label>
              Tipo de usuário
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
            </label>
          </div>
        </details>
        {loading ? <LoadingState message="Carregando usuarios..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Itens carregados" value={summary.total} subtitle="nesta página" />
          <KpiCard title="Motoristas" value={summary.drivers} subtitle="nesta página" />
          <KpiCard title="Clientes" value={summary.customers} subtitle="nesta página" />
          <KpiCard title="Pendentes" value={summary.pending} subtitle="nesta página" tone="warning" />
        </section>

        <section className="grid">
          <Panel
            className="panel-span-full"
            title="Usuários"
            subtitle="Workspace de consulta com acesso à ficha dedicada de cada conta."
          >
            <div
              className="table-shell"
              role="region"
              tabIndex={0}
              aria-label="Usuários cadastrados"
            >
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5}>Nenhum usuário encontrado para os filtros atuais.</td>
                    </tr>
                  ) : (
                    users.map((user, idx) => {
                      const userId = user.id || user.uid;
                      const userType = String(user.type || user.usertype || "-").toLowerCase();
                      const userStatus = String(user.status || "-").toLowerCase();
                      const badgeClass = statusTone[userStatus] || "status-warn";

                      return (
                        <tr key={userId || `u-${idx}`}>
                          <td>
                            <strong>{user.name || user.displayName || "-"}</strong>
                            <span className="table-muted">{userId || "-"}</span>
                          </td>
                          <td>{user.email || "-"}</td>
                          <td>{userType}</td>
                          <td>
                            <span className={badgeClass}>{userStatus}</span>
                          </td>
                          <td>
                            <div className="actions-cell">
                              {userId ? <Link href={`/users/${userId}`}>Abrir ficha</Link> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
              <span>Pagina {page}</span>
              <button type="button" onClick={() => setPage((p) => p + 1)}>Proxima</button>
            </div>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
