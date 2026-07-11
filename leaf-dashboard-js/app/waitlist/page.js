"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import { useAuth } from "@/src/contexts/AuthContext";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";
import {
  hasAnyRole,
  isAdminMutationEnabled,
  mutationBlockedMessage,
  roleBlockedMessage,
} from "@/src/utils/dashboard-access";

function waitlistStatusClass(status) {
  if (status === "approved") return "status-ok";
  if (status === "rejected") return "status-bad";
  return "status-warn";
}

function waitlistStatusLabel(status) {
  const normalized = String(status || "pending").toLowerCase();
  const labels = {
    pending: "Pendente",
    approved: "Aprovado",
    rejected: "Rejeitado",
    contacted: "Contatado",
    converted: "Convertido",
  };
  return labels[normalized] || normalized;
}

function cityOperationalState(city) {
  if (!city) return { enabled: true, label: "sem dado", className: "meta-badge" };
  if (city.stateEnabled === false) return { enabled: false, label: "UF bloqueada", className: "status-bad" };
  if (city.cityActive === false) return { enabled: false, label: "cidade inativa", className: "status-bad" };
  if (city.waitlistEnabled === false) return { enabled: false, label: "waitlist off", className: "status-warn" };
  return { enabled: true, label: "ativa", className: "status-ok" };
}

export default function WaitlistPage() {
  const { user } = useAuth();
  const [drivers, setDrivers] = useState([]);
  const [landingLeads, setLandingLeads] = useState([]);
  const [landingStats, setLandingStats] = useState(null);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const [status, setStatus] = useState("pending");
  const [cityFilter, setCityFilter] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionDriverId, setActionDriverId] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [confirmationReason, setConfirmationReason] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const allowedRoles = useMemo(() => ["admin", "super-admin", "manager"], []);
  const roleMessage = roleBlockedMessage(user, allowedRoles);
  const mutationMessage = mutationBlockedMessage(runtimeFlags);
  const canReadWaitlist = hasAnyRole(user, allowedRoles);
  const globalWaitlistEnabled = stats?.config?.waitListEnabled !== false;
  const canMutateWaitlist = canReadWaitlist && globalWaitlistEnabled && isAdminMutationEnabled(runtimeFlags);
  const actionBlockedMessage =
    roleMessage ||
    mutationMessage ||
    (!globalWaitlistEnabled ? "A waitlist está desabilitada na configuração do backend. Ações ficam bloqueadas." : "");
  const cityStatusByKey = useMemo(() => {
    const entries = (stats?.byCity || []).map((city) => [city.cityKey, cityOperationalState(city)]);
    return new Map(entries);
  }, [stats?.byCity]);
  const filteredDrivers = useMemo(() => {
    const term = driverSearch.trim().toLowerCase();
    if (!term) return drivers;
    return drivers.filter((item) =>
      `${item?.id || ""} ${item?.cityLabel || item?.cityKey || ""} ${item?.driver?.firstName || ""} ${item?.driver?.lastName || ""} ${item?.driver?.email || ""} ${item?.status || ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [drivers, driverSearch]);

  const loadWaitlist = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      if (!silent) setNotice("");

      const flags = await leafAPI.getRuntimeFlags().catch(() => null);
      setRuntimeFlags(flags);

      if (!hasAnyRole(user, allowedRoles)) {
        setDrivers([]);
        setLandingLeads([]);
        setLandingStats(null);
        setPagination(null);
        setStats(null);
        return;
      }

      const [listData, statsData, landingData] = await Promise.all([
        leafAPI.getWaitlist(page, 20, status, cityFilter),
        leafAPI.getWaitlistStats(),
        leafAPI.getLandingWaitlist({ page: 1, limit: 50, status: "all" }).catch(() => ({ waitlist: [], stats: null })),
      ]);
      setDrivers(listData?.drivers || []);
      setLandingLeads(landingData?.waitlist || []);
      setLandingStats(landingData?.stats || null);
      setPagination(listData?.pagination || null);
      setStats(statsData);
    } catch (err) {
      setError(err?.message || "Falha ao carregar waitlist");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [allowedRoles, cityFilter, page, status, user]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      await loadWaitlist();
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadWaitlist]);

  const runDriverAction = async (driverId, action, rejectionReason = "") => {
    const safeDriverId = String(driverId || "").trim();
    if (!safeDriverId) return;
    if (!canMutateWaitlist) {
      setError(actionBlockedMessage || "Ação bloqueada para este perfil.");
      return;
    }

    try {
      setActionDriverId(safeDriverId);
      setError("");
      setNotice("");
      if (action === "approve") {
        await leafAPI.approveWaitlistDriver(safeDriverId, "Aprovado pelo dashboard Leaf");
        setNotice("Motorista aprovado e liberado para ativação.");
      } else if (action === "reject") {
        await leafAPI.rejectWaitlistDriver(safeDriverId, rejectionReason);
        setNotice("Motorista rejeitado e removido da fila ativa.");
      }
      await loadWaitlist({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao atualizar waitlist");
    } finally {
      setActionDriverId("");
    }
  };

  const updateLandingLead = async (leadId, nextStatus) => {
    if (!canMutateWaitlist) {
      setError(actionBlockedMessage || "Ação bloqueada para este perfil.");
      return;
    }
    try {
      setActionDriverId(`landing:${leadId}`);
      setError("");
      setNotice("");
      await leafAPI.updateLandingWaitlistStatus(leadId, nextStatus);
      setNotice("Lead da landing atualizado com sucesso.");
      await loadWaitlist({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao atualizar lead da landing");
    } finally {
      setActionDriverId("");
    }
  };

  const requestDriverAction = (item, action) => {
    const driverId = String(item?.driverId || item?.id || "").trim();
    if (!driverId) return;
    if (!canMutateWaitlist) {
      setError(actionBlockedMessage || "Ação bloqueada para este perfil.");
      return;
    }

    const isApproval = action === "approve";
    const driverName = `${item?.driver?.firstName || ""} ${item?.driver?.lastName || ""}`.trim();
    const city = (stats?.byCity || []).find((entry) => entry?.cityKey === item?.cityKey);
    const cityLabel = item?.cityLabel || item?.cityKey || "Não informada";
    const details = [
      {
        label: "Identidade",
        value: `${driverName || "Sem nome"} · ${item?.driver?.email || driverId}`,
      },
      { label: "Cidade", value: city?.stateCode ? `${cityLabel} (${city.stateCode})` : cityLabel },
      { label: "Estado atual", value: waitlistStatusLabel(item?.status) },
      { label: "Novo estado", value: waitlistStatusLabel(isApproval ? "approved" : "rejected") },
    ];
    if (city) {
      details.push({
        label: "Capacidade territorial",
        value: `${Number(city.maxActiveDrivers || 0)} motorista(s) · ${Number(city.availableSlots || 0)} slot(s)`,
      });
    }

    setConfirmationReason(isApproval ? "" : "Perfil fora dos critérios atuais");
    setConfirmationError("");
    setPendingConfirmation({
      title: isApproval ? "Aprovar este motorista?" : "Rejeitar este motorista?",
      description: "Revise a identidade e o impacto antes de atualizar a waitlist.",
      confirmLabel: isApproval ? "Aprovar motorista" : "Rejeitar motorista",
      tone: isApproval ? "warning" : "danger",
      details,
      requiresReason: !isApproval,
      consequence: isApproval
        ? "O motorista será aprovado e liberado para ativação conforme a capacidade e as regras atuais."
        : "O motorista será rejeitado e removido da fila ativa.",
      execute: ({ reason }) => runDriverAction(driverId, action, reason),
    });
  };

  const requestLandingLeadUpdate = (lead, nextStatus) => {
    if (!lead?.id) return;
    if (!canMutateWaitlist) {
      setError(actionBlockedMessage || "Ação bloqueada para este perfil.");
      return;
    }

    const leadName = `${lead?.nome || ""} ${lead?.sobrenome || ""}`.trim();
    setConfirmationReason("");
    setConfirmationError("");
    setPendingConfirmation({
      title: nextStatus === "converted" ? "Marcar lead como convertido?" : "Marcar lead como contatado?",
      description: "Confirme a transição deste lead da landing.",
      confirmLabel: nextStatus === "converted" ? "Marcar convertido" : "Marcar contatado",
      tone: "warning",
      details: [
        { label: "Identidade", value: `${leadName || "Sem nome"} · ${lead?.celular || lead.id}` },
        { label: "Cidade", value: lead?.cidade || "Não informada" },
        { label: "Estado atual", value: waitlistStatusLabel(lead?.status) },
        { label: "Novo estado", value: waitlistStatusLabel(nextStatus) },
      ],
      consequence: "O status do lead será atualizado no funil da landing, mantendo a regra vigente.",
      execute: () => updateLandingLead(lead.id, nextStatus),
    });
  };

  const closeConfirmation = () => {
    if (actionDriverId) return;
    setPendingConfirmation(null);
    setConfirmationReason("");
    setConfirmationError("");
  };

  const confirmPendingAction = async () => {
    if (!pendingConfirmation?.execute || actionDriverId) return;

    const reason = confirmationReason.trim();
    if (pendingConfirmation.requiresReason && !reason) {
      setConfirmationError("Informe o motivo da rejeição antes de continuar.");
      return;
    }

    const action = pendingConfirmation;
    try {
      setConfirmationError("");
      await action.execute({ reason });
    } finally {
      setPendingConfirmation((current) => (current === action ? null : current));
      setConfirmationReason("");
    }
  };

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
          <KpiCard title="Leads landing" value={landingStats?.total || 0} />
          <KpiCard title="Leads contactados" value={landingStats?.contacted || stats?.funnel?.landing?.contacted || 0} />
          <KpiCard title="Leads convertidos" value={landingStats?.converted || stats?.funnel?.landing?.converted || 0} tone="positive" />
          <KpiCard
            title="Slots disponíveis"
            value={globalWaitlistEnabled ? (stats?.stats?.availableSlots || 0) : "bloqueado"}
            tone={globalWaitlistEnabled ? "default" : "danger"}
          />
        </section>
        {roleMessage || mutationMessage || !globalWaitlistEnabled ? (
          <ErrorText message={actionBlockedMessage} />
        ) : null}

        <section className="grid">
          <details className="waitlist-capacity-disclosure">
            <summary>Capacidade territorial e configuração avançada</summary>
            <div className="grid">
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
                    landingPending: landingStats?.pending || stats?.funnel?.landing?.pending || 0,
                    landingConverted: landingStats?.converted || stats?.funnel?.landing?.converted || 0,
                    passengerWaitlist: stats?.funnel?.contract?.passengerWaitlist ? "sim" : "não",
                    totalCities: (stats?.byCity || []).length,
                    currentPage: pagination?.page || page,
                    waitListEnabled: globalWaitlistEnabled ? "sim" : "não",
                  }}
                  labels={{
                    pending: "Pendentes",
                    approved: "Aprovados",
                    rejected: "Rejeitados",
                    availableSlots: "Slots disponiveis",
                    landingPending: "Landing pendente",
                    landingConverted: "Landing convertida",
                    passengerWaitlist: "Waitlist passageiro",
                    totalCities: "Cidades monitoradas",
                    currentPage: "Pagina atual",
                    waitListEnabled: "Waitlist global",
                  }}
                />
                <TechnicalDetails title="Ver payload técnico da waitlist" data={stats || {}} />
              </Panel>
              <Panel title="Capacidade por Cidade" subtitle="Leitura de oferta por UF/cidade para gestão de abertura.">
                <div
                  className="table-shell"
                  role="region"
                  tabIndex={0}
                  aria-label="Capacidade da lista de espera por cidade"
                >
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
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats?.byCity || []).map((city) => {
                        const cityState = cityOperationalState(city);
                        return (
                          <tr key={city.cityKey}>
                            <td>{city.cityLabel || city.cityKey}</td>
                            <td>{city.stateCode || "-"}</td>
                            <td>{city.pending || 0}</td>
                            <td>{city.approved || 0}</td>
                            <td>{city.rejected || 0}</td>
                            <td>{city.maxActiveDrivers || 0}</td>
                            <td>{cityState.enabled ? (city.availableSlots || 0) : "bloqueado"}</td>
                            <td><span className={cityState.className}>{cityState.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          </details>
          <Panel title="Motoristas" subtitle="Fila operacional por cidade e prioridade de ativação.">
            <div className="filters">
              <input
                placeholder="Filtrar por nome, e-mail ou cidade"
                value={driverSearch}
                onChange={(e) => setDriverSearch(e.target.value)}
              />
            </div>
            <div
              className="table-shell"
              role="region"
              tabIndex={0}
              aria-label="Motoristas na lista de espera"
            >
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Posição</th>
                    <th>Cidade</th>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Prioridade</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Nenhum motorista na waitlist para este filtro.</td>
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
                          <span className={waitlistStatusClass(item.status)}>
                            {item.status || "-"}
                          </span>
                        </td>
                        <td>{item.priority || "normal"}</td>
                        <td>
                          {item.status === "pending" ? (
                            <div className="row-actions">
                              <button
                                type="button"
                                onClick={() => requestDriverAction(item, "approve")}
                                disabled={
                                  !canMutateWaitlist ||
                                  actionDriverId === (item.driverId || item.id) ||
                                  cityStatusByKey.get(item.cityKey)?.enabled === false
                                }
                                title={!canMutateWaitlist ? actionBlockedMessage : cityStatusByKey.get(item.cityKey)?.label}
                              >
                                Aprovar
                              </button>
                              <button
                                type="button"
                                className="button-secondary"
                                onClick={() => requestDriverAction(item, "reject")}
                                disabled={!canMutateWaitlist || actionDriverId === (item.driverId || item.id)}
                                title={!canMutateWaitlist ? actionBlockedMessage : undefined}
                              >
                                Rejeitar
                              </button>
                            </div>
                          ) : (
                            <span className="muted">Sem ação</span>
                          )}
                        </td>
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
          <Panel title="Leads da landing" subtitle="Cadastros captados fora do app para contato e conversão.">
            <KeyValueGrid
              data={{
                total: landingStats?.total || 0,
                pending: landingStats?.pending || 0,
                contacted: landingStats?.contacted || 0,
                converted: landingStats?.converted || 0,
                today: landingStats?.today || 0,
              }}
              labels={{
                total: "Total",
                pending: "Pendentes",
                contacted: "Contatados",
                converted: "Convertidos",
                today: "Hoje",
              }}
              maxItems={5}
            />
            <div
              className="table-shell"
              role="region"
              tabIndex={0}
              aria-label="Motoristas convertidos da lista de espera"
            >
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Telefone</th>
                    <th>Cidade</th>
                    <th>Status</th>
                    <th>Origem</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {landingLeads.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Nenhum lead da landing encontrado.</td>
                    </tr>
                  ) : (
                    landingLeads.slice(0, 20).map((lead) => (
                      <tr key={lead.id}>
                        <td>{`${lead.nome || ""} ${lead.sobrenome || ""}`.trim() || "-"}</td>
                        <td>{lead.celular || "-"}</td>
                        <td>{lead.cidade || "-"}</td>
                        <td><span className={waitlistStatusClass(lead.status)}>{lead.status || "pending"}</span></td>
                        <td>{lead.origem || "landing"}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              disabled={!canMutateWaitlist || actionDriverId === `landing:${lead.id}`}
                              onClick={() => requestLandingLeadUpdate(lead, "contacted")}
                            >
                              Contatado
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              disabled={!canMutateWaitlist || actionDriverId === `landing:${lead.id}`}
                              onClick={() => requestLandingLeadUpdate(lead, "converted")}
                            >
                              Convertido
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
        {notice ? <p className="success-text">{notice}</p> : null}
        <ErrorText message={error} />
        <ConfirmActionDialog
          open={Boolean(pendingConfirmation)}
          title={pendingConfirmation?.title}
          description={pendingConfirmation?.description}
          confirmLabel={pendingConfirmation?.confirmLabel}
          tone={pendingConfirmation?.tone}
          busy={Boolean(actionDriverId)}
          onConfirm={confirmPendingAction}
          onCancel={closeConfirmation}
        >
          <div className="confirm-dialog-context">
            {(pendingConfirmation?.details || []).map((detail) => (
              <p key={detail.label} className="confirm-dialog-context-row">
                <strong>{detail.label}:</strong> {detail.value}
              </p>
            ))}
            {pendingConfirmation?.requiresReason ? (
              <label className="form-field confirm-dialog-reason-field">
                Motivo da rejeição
                <textarea
                  value={confirmationReason}
                  onChange={(event) => {
                    setConfirmationReason(event.target.value);
                    setConfirmationError("");
                  }}
                  required
                />
              </label>
            ) : null}
            {confirmationError ? <p className="error">{confirmationError}</p> : null}
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
