"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";

const OPEN_STATUSES = new Set(["open", "assigned", "in_progress", "escalated"]);
const SUPPORT_POLL_MS = 30000;
const MESSAGE_POLL_MS = 5000;

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

function formatMinutes(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
}

function formatAge(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function getTicketTitle(ticket) {
  return ticket?.subject || ticket?.title || `Ticket ${ticket?.id || ""}`.trim();
}

function getTicketDescription(ticket) {
  return ticket?.description || ticket?.metadata?.description || ticket?.resolution || "";
}

function statusBadge(status) {
  const normalized = normalize(status || "open");
  if (["resolved", "closed"].includes(normalized)) return "status-ok";
  if (["escalated", "blocked", "overdue"].includes(normalized)) return "status-bad";
  return "status-warn";
}

function priorityBadge(priority) {
  const normalized = String(priority || "N3").toUpperCase();
  if (normalized === "N1") return "status-bad";
  if (normalized === "N2") return "status-warn";
  return "status-ok";
}

function confidenceBadge(confidence) {
  const value = Number(confidence || 0);
  if (value >= 0.72) return "status-ok";
  if (value >= 0.5) return "status-warn";
  return "status-bad";
}

function formatConfidence(confidence) {
  const value = Number(confidence || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${Math.round(value * 100)}%`;
}

function queueHealthBadge(ticket) {
  if (ticket?.queue?.overdueFirstResponse) return { className: "status-bad", label: "1a resposta vencida" };
  if (ticket?.queue?.overdueAck) return { className: "status-bad", label: "ack vencido" };
  if (OPEN_STATUSES.has(normalize(ticket?.status))) return { className: "status-warn", label: "em SLA" };
  return { className: "status-ok", label: "sem pendência" };
}

function ticketMatchesSearch(ticket, term) {
  if (!term) return true;
  const searchable = [
    ticket?.id,
    getTicketTitle(ticket),
    getTicketDescription(ticket),
    ticket?.status,
    ticket?.priority,
    ticket?.category,
    ticket?.userId,
    ticket?.user?.name,
    ticket?.user?.email,
    ticket?.metadata?.bookingId,
    ticket?.metadata?.incidentId,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  return searchable.includes(term);
}

function deriveSummary(tickets, queueSummary) {
  const source = queueSummary || {};
  const openTickets = tickets.filter((ticket) => OPEN_STATUSES.has(normalize(ticket?.status)));
  const byPriority = source.backlogByPriority || {};

  return {
    totalOpenTickets: Number(source.totalOpenTickets ?? openTickets.length ?? 0),
    n1: Number(byPriority.N1 ?? tickets.filter((ticket) => ticket?.priority === "N1").length),
    n2: Number(byPriority.N2 ?? tickets.filter((ticket) => ticket?.priority === "N2").length),
    n3: Number(byPriority.N3 ?? tickets.filter((ticket) => ticket?.priority === "N3").length),
    overdueAckCount: Number(source.overdueAckCount ?? tickets.filter((ticket) => ticket?.queue?.overdueAck).length),
    overdueFirstResponseCount: Number(
      source.overdueFirstResponseCount ?? tickets.filter((ticket) => ticket?.queue?.overdueFirstResponse).length,
    ),
    ticketsWithoutOwner: Number(source.ticketsWithoutOwner ?? tickets.filter((ticket) => !ticket?.assignedAgent).length),
    criticalBacklogCount: Number(source.criticalBacklogCount ?? tickets.filter((ticket) => Number(ticket?.queue?.ageHours || 0) >= 12).length),
    medianFirstResponseMinutes: source.medianFirstResponseMinutes ?? null,
  };
}

export default function SupportPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [queueSummary, setQueueSummary] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatStatus, setChatStatus] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [ticketSearch, setTicketSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState("");
  const [mode, setMode] = useState("ticket");
  const [orchestratorStatus, setOrchestratorStatus] = useState(null);
  const [orchestratorRuns, setOrchestratorRuns] = useState([]);
  const [orchestratorAnalysis, setOrchestratorAnalysis] = useState(null);
  const [orchestratorLoading, setOrchestratorLoading] = useState(false);
  const [orchestratorError, setOrchestratorError] = useState("");

  const selectedUserId = selectedTicket?.userId || selectedTicket?.user?.id || null;
  const orchestratorEnabled = leafAPI.isSupportOrchestratorEnabled();

  const loadTickets = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        let nextTickets = [];
        let nextSummary = null;

        try {
          const [summaryResponse, backlogResponse] = await Promise.all([
            leafAPI.getSupportQueueSummary(),
            leafAPI.getSupportQueueBacklog({
              status: statusFilter === "all" ? undefined : statusFilter,
              priority: priorityFilter === "all" ? undefined : priorityFilter,
              limit: 200,
              offset: 0,
            }),
          ]);
          nextSummary = summaryResponse?.summary || null;
          nextTickets = backlogResponse?.tickets || [];
        } catch {
          const fallback = await leafAPI.getSupportTickets({
            status: statusFilter === "all" ? undefined : statusFilter,
            priority: priorityFilter === "all" ? undefined : priorityFilter,
            page: 1,
            limit: 200,
          });
          nextTickets = fallback?.tickets || [];
          nextSummary = fallback?.summary || null;
        }

        const sorted = [...nextTickets].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        setTickets(sorted);
        setQueueSummary(nextSummary);
        setSelectedTicket((current) => {
          if (!current) return sorted[0] || null;
          return sorted.find((ticket) => ticket.id === current.id) || sorted[0] || null;
        });
      } catch (err) {
        setError(err?.message || "Falha ao carregar fila de suporte");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [priorityFilter, statusFilter],
  );

  const loadOrchestratorOverview = useCallback(async () => {
    if (!orchestratorEnabled) return;
    setOrchestratorError("");
    try {
      const [statusResponse, runsResponse] = await Promise.all([
        leafAPI.getSupportOrchestratorStatus(),
        leafAPI.getSupportOrchestratorRuns(8),
      ]);
      setOrchestratorStatus(statusResponse?.status || null);
      setOrchestratorRuns(runsResponse?.runs || []);
    } catch (err) {
      setOrchestratorError(err?.message || "Falha ao consultar orquestrador");
    }
  }, [orchestratorEnabled]);

  useEffect(() => {
    let mounted = true;
    const run = async (options) => {
      if (!mounted) return;
      await loadTickets(options);
    };
    run();
    const timer = setInterval(() => run({ silent: true }), SUPPORT_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadTickets]);

  useEffect(() => {
    if (!orchestratorEnabled) return undefined;
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await loadOrchestratorOverview();
    };
    run();
    const timer = setInterval(run, SUPPORT_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadOrchestratorOverview, orchestratorEnabled]);

  useEffect(() => {
    if (!selectedTicket) {
      setTicketMessages([]);
      return;
    }
    let mounted = true;
    const loadTicketMessages = async () => {
      try {
        const response = await leafAPI.getSupportMessages(selectedTicket.id);
        if (mounted) setTicketMessages(response?.messages || []);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar mensagens do ticket");
      }
    };
    loadTicketMessages();
    const timer = setInterval(loadTicketMessages, MESSAGE_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedTicket]);

  useEffect(() => {
    if (!selectedUserId) {
      setChatMessages([]);
      setChatStatus(null);
      return;
    }
    let mounted = true;
    const loadChatData = async () => {
      try {
        const [history, status] = await Promise.all([
          leafAPI.getChatHistory(selectedUserId, 80).catch(() => ({ messages: [] })),
          leafAPI.getChatStatus(selectedUserId).catch(() => ({ status: { status: "unknown" } })),
        ]);
        if (!mounted) return;
        setChatMessages(history?.messages || []);
        setChatStatus(status?.status || null);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar chat");
      }
    };
    loadChatData();
    const timer = setInterval(loadChatData, MESSAGE_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedUserId]);

  useEffect(() => {
    if (!orchestratorEnabled || !selectedTicket?.id) {
      setOrchestratorAnalysis(null);
      return;
    }

    let mounted = true;
    const loadAnalysis = async () => {
      try {
        setOrchestratorLoading(true);
        setOrchestratorError("");
        const response = await leafAPI.getSupportOrchestratorTicketAnalysis(selectedTicket.id);
        if (mounted) setOrchestratorAnalysis(response?.analysis || null);
      } catch (err) {
        if (mounted) setOrchestratorError(err?.message || "Falha ao analisar ticket");
      } finally {
        if (mounted) setOrchestratorLoading(false);
      }
    };

    loadAnalysis();
    return () => {
      mounted = false;
    };
  }, [orchestratorEnabled, selectedTicket?.id]);

  const summary = useMemo(() => deriveSummary(tickets, queueSummary), [queueSummary, tickets]);
  const currentMessages = useMemo(
    () => (mode === "ticket" ? ticketMessages : chatMessages),
    [mode, ticketMessages, chatMessages],
  );
  const filteredTickets = useMemo(() => {
    const term = ticketSearch.trim().toLowerCase();
    return tickets.filter((ticket) => ticketMatchesSearch(ticket, term));
  }, [tickets, ticketSearch]);
  const filteredMessages = useMemo(() => {
    const term = messageSearch.trim().toLowerCase();
    if (!term) return currentMessages;
    return currentMessages.filter((message) =>
      `${message?.senderType || ""} ${message?.senderId || ""} ${message?.message || ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [currentMessages, messageSearch]);

  const selectedTicketDetails = useMemo(() => {
    if (!selectedTicket) return {};
    return {
      id: selectedTicket.id,
      prioridade: selectedTicket.priority || "N3",
      status: selectedTicket.status || "open",
      categoria: selectedTicket.category || "-",
      usuario: selectedTicket.user?.name || selectedTicket.userId || "-",
      tipoUsuario: selectedTicket.userType || "-",
      responsavel: selectedTicket.assignedAgentName || selectedTicket.assignedAgent || "sem dono",
      criadoEm: formatDateTime(selectedTicket.createdAt),
      idade: formatAge(selectedTicket.queue?.ageMs),
      ackSla: formatDateTime(selectedTicket.queue?.ackTargetAt),
      primeiraRespostaSla: formatDateTime(selectedTicket.queue?.firstResponseTargetAt),
      bookingId: selectedTicket.metadata?.bookingId || "-",
      incidentId: selectedTicket.metadata?.incidentId || "-",
    };
  }, [selectedTicket]);

  const sendMessage = async () => {
    if (!selectedTicket || !newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage("");
    try {
      if (mode === "chat" && selectedUserId) {
        await leafAPI.sendChatMessage(selectedUserId, text);
        const history = await leafAPI.getChatHistory(selectedUserId, 80);
        setChatMessages(history?.messages || []);
      } else {
        await leafAPI.sendSupportMessage(selectedTicket.id, text);
        const response = await leafAPI.getSupportMessages(selectedTicket.id);
        setTicketMessages(response?.messages || []);
      }
      await loadTickets({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao enviar mensagem");
      setNewMessage(text);
    }
  };

  const assignToMe = async () => {
    if (!selectedTicket) return;
    const agentId = user?.id || user?.uid || user?.email || "dashboard-agent";
    const agentName = user?.name || user?.email || agentId;
    try {
      setActionBusy("assign");
      await leafAPI.assignSupportTicket(selectedTicket.id, agentId, agentName);
      await loadTickets({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao atribuir ticket");
    } finally {
      setActionBusy("");
    }
  };

  const escalateTicket = async () => {
    if (!selectedTicket) return;
    const reason = window.prompt("Motivo da escalacao:");
    if (!reason) return;
    try {
      setActionBusy("escalate");
      await leafAPI.escalateSupportTicket(selectedTicket.id, reason.trim());
      await loadTickets({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao escalar ticket");
    } finally {
      setActionBusy("");
    }
  };

  const resolveTicket = async () => {
    if (!selectedTicket) return;
    const resolution = window.prompt("Resumo da resolucao:");
    if (resolution === null) return;
    try {
      setActionBusy("resolve");
      await leafAPI.resolveSupportTicket(selectedTicket.id, resolution.trim());
      await loadTickets({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao resolver ticket");
    } finally {
      setActionBusy("");
    }
  };

  const closeChat = async () => {
    if (!selectedUserId) return;
    if (!window.confirm("Encerrar chat deste usuario?")) return;
    try {
      await leafAPI.closeChat(selectedUserId, "agent");
      const status = await leafAPI.getChatStatus(selectedUserId);
      setChatStatus(status?.status || null);
    } catch (err) {
      setError(err?.message || "Falha ao encerrar chat");
    }
  };

  const refreshOrchestratorAnalysis = async () => {
    if (!selectedTicket?.id || !orchestratorEnabled) return;
    try {
      setOrchestratorLoading(true);
      setOrchestratorError("");
      const response = await leafAPI.getSupportOrchestratorTicketAnalysis(selectedTicket.id, { force: true });
      setOrchestratorAnalysis(response?.analysis || null);
      await loadOrchestratorOverview();
    } catch (err) {
      setOrchestratorError(err?.message || "Falha ao rodar orquestrador");
    } finally {
      setOrchestratorLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Suporte</h1>
            <p>Fila operacional N1/N2/N3 com SLA, ownership, ticket e chat.</p>
          </div>
          <div className="filters">
            <span className="meta-badge">Polling: 30s</span>
            <input
              placeholder="Buscar ticket, usuario, corrida"
              value={ticketSearch}
              onChange={(event) => setTicketSearch(event.target.value)}
            />
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">Todas prioridades</option>
              <option value="N1">N1</option>
              <option value="N2">N2</option>
              <option value="N3">N3</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos status</option>
              <option value="open">Abertos</option>
              <option value="assigned">Atribuidos</option>
              <option value="in_progress">Em andamento</option>
              <option value="escalated">Escalados</option>
              <option value="resolved">Resolvidos</option>
              <option value="closed">Fechados</option>
            </select>
            <button type="button" onClick={() => loadTickets({ silent: false })}>
              Atualizar
            </button>
          </div>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando suporte..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Abertos" value={summary.totalOpenTickets} />
          <KpiCard title="N1" value={summary.n1} tone={summary.n1 > 0 ? "danger" : "default"} />
          <KpiCard title="N2" value={summary.n2} tone={summary.n2 > 0 ? "warning" : "default"} />
          <KpiCard title="N3" value={summary.n3} />
          <KpiCard title="Ack vencido" value={summary.overdueAckCount} tone={summary.overdueAckCount > 0 ? "danger" : "positive"} />
          <KpiCard
            title="1a resposta vencida"
            value={summary.overdueFirstResponseCount}
            tone={summary.overdueFirstResponseCount > 0 ? "danger" : "positive"}
          />
          <KpiCard title="Sem dono" value={summary.ticketsWithoutOwner} tone={summary.ticketsWithoutOwner > 0 ? "warning" : "positive"} />
          <KpiCard
            title="FRT mediana"
            value={formatMinutes(summary.medianFirstResponseMinutes)}
            subtitle="tickets respondidos"
          />
        </section>

        <section className="grid orchestrator-grid">
          <Panel
            title="Orquestrador de agents"
            subtitle={
              orchestratorEnabled
                ? "Copiloto conectado ao playbook, tickets e contexto operacional."
                : "Pronto para receber o servico externo quando NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_URL estiver configurado."
            }
            actions={
              orchestratorEnabled ? (
                <button type="button" onClick={loadOrchestratorOverview}>
                  Atualizar agent
                </button>
              ) : null
            }
          >
            <div className="orchestrator-summary">
              <span className={orchestratorEnabled ? "status-ok" : "status-warn"}>
                {orchestratorEnabled ? "conectado" : "nao configurado"}
              </span>
              <span className="meta-badge">modo: {orchestratorStatus?.mode || "copiloto"}</span>
              <span className="meta-badge">playbook: {orchestratorStatus?.playbook?.version || "local"}</span>
              <span className="meta-badge">
                polling: {orchestratorStatus?.polling?.enabled === false ? "off" : "on"}
              </span>
              {orchestratorError ? <span className="status-bad">{orchestratorError}</span> : null}
            </div>

            {orchestratorRuns.length > 0 ? (
              <div className="run-list">
                {orchestratorRuns.slice(0, 4).map((run) => (
                  <div key={run.id} className="run-row">
                    <strong>{run.ticketId || run.userId || run.source}</strong>
                    <span>{run.classification?.supportTier || "-"} / {run.classification?.category || "-"}</span>
                    <span className={confidenceBadge(run.classification?.confidence)}>
                      {formatConfidence(run.classification?.confidence)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">
                {orchestratorEnabled
                  ? "Sem execucoes recentes ainda."
                  : "O dashboard ja tem o contrato de leitura preparado para o orquestrador desacoplado."}
              </p>
            )}
          </Panel>
        </section>

        <section className="grid support-grid">
          <Panel
            title="Tickets"
            subtitle={`${filteredTickets.length} item(ns) nos filtros atuais.`}
          >
            <div className="support-list">
              {filteredTickets.map((ticket) => {
                const health = queueHealthBadge(ticket);
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    className={selectedTicket?.id === ticket.id ? "ticket-btn ticket-btn-active" : "ticket-btn"}
                    onClick={() => setSelectedTicket(ticket)}
                  >
                    <strong>{getTicketTitle(ticket)}</strong>
                    <span className="ticket-meta-row">
                      <span className={priorityBadge(ticket.priority)}>{ticket.priority || "N3"}</span>
                      <span className={statusBadge(ticket.status)}>{ticket.status || "open"}</span>
                      <span className={health.className}>{health.label}</span>
                    </span>
                    <span>
                      {ticket.user?.name || ticket.userId || "usuario sem identificacao"}
                      {ticket.queue?.ageMs ? ` • ${formatAge(ticket.queue.ageMs)}` : ""}
                    </span>
                    {ticket.assignedAgentName || ticket.assignedAgent ? (
                      <span className="table-muted">Dono: {ticket.assignedAgentName || ticket.assignedAgent}</span>
                    ) : (
                      <span className="table-muted">Sem dono</span>
                    )}
                  </button>
                );
              })}
              {filteredTickets.length === 0 ? (
                <p className="text-muted">Nenhum ticket encontrado para os filtros atuais.</p>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Atendimento"
            actions={
              selectedTicket ? (
                <>
                  <button
                    type="button"
                    className={mode === "ticket" ? "mode-btn mode-btn-active" : "mode-btn"}
                    onClick={() => setMode("ticket")}
                  >
                    Ticket
                  </button>
                  <button
                    type="button"
                    className={mode === "chat" ? "mode-btn mode-btn-active" : "mode-btn"}
                    onClick={() => setMode("chat")}
                  >
                    Chat
                  </button>
                  <button type="button" disabled={!!actionBusy} onClick={assignToMe}>
                    Assumir
                  </button>
                  <button type="button" disabled={!!actionBusy} onClick={escalateTicket}>
                    Escalar
                  </button>
                  <button type="button" disabled={!!actionBusy} onClick={resolveTicket}>
                    Resolver
                  </button>
                  {orchestratorEnabled ? (
                    <button type="button" disabled={orchestratorLoading} onClick={refreshOrchestratorAnalysis}>
                      Rodar agent
                    </button>
                  ) : null}
                  {mode === "chat" ? (
                    <button type="button" onClick={closeChat} disabled={chatStatus?.status === "closed"}>
                      Encerrar chat
                    </button>
                  ) : null}
                </>
              ) : null
            }
          >
            {selectedTicket ? (
              <div className="section-stack">
                <KeyValueGrid
                  data={selectedTicketDetails}
                  labels={{
                    id: "Ticket",
                    prioridade: "Prioridade",
                    status: "Status",
                    categoria: "Categoria",
                    usuario: "Usuario",
                    tipoUsuario: "Tipo",
                    responsavel: "Responsavel",
                    criadoEm: "Criado em",
                    idade: "Idade",
                    ackSla: "SLA ack",
                    primeiraRespostaSla: "SLA 1a resposta",
                    bookingId: "Corrida",
                    incidentId: "Incidente",
                  }}
                  maxItems={13}
                />

                {mode === "chat" ? (
                  <p className="text-muted">
                    Status do chat: <strong>{chatStatus?.status || "desconhecido"}</strong>
                  </p>
                ) : null}

                {orchestratorEnabled ? (
                  <div className="agent-recommendation">
                    <div className="ticket-meta-row">
                      <strong>Copiloto agent</strong>
                      {orchestratorLoading ? <span className="meta-badge">analisando</span> : null}
                      {orchestratorAnalysis?.classification ? (
                        <>
                          <span className={priorityBadge(orchestratorAnalysis.classification.priority)}>
                            {orchestratorAnalysis.classification.priority}
                          </span>
                          <span className="meta-badge">{orchestratorAnalysis.classification.supportTier}</span>
                          <span className={confidenceBadge(orchestratorAnalysis.classification.confidence)}>
                            {formatConfidence(orchestratorAnalysis.classification.confidence)}
                          </span>
                        </>
                      ) : null}
                    </div>

                    {orchestratorAnalysis?.recommendation ? (
                      <>
                        <p>{orchestratorAnalysis.recommendation.n1?.reply || "Sem sugestao de resposta."}</p>
                        <div className="orchestrator-summary">
                          <span className="meta-badge">acao: {orchestratorAnalysis.recommendation.nextAction}</span>
                          <span className="meta-badge">categoria: {orchestratorAnalysis.classification?.category || "-"}</span>
                          <span className="meta-badge">
                            humano: {orchestratorAnalysis.classification?.needsHuman ? "sim" : "nao"}
                          </span>
                          <span className="meta-badge">
                            web search: {orchestratorAnalysis.audit?.internetSearchUsed ? "sim" : "nao"}
                          </span>
                        </div>
                        {orchestratorAnalysis.classification?.rationale?.length ? (
                          <ul className="agent-rationale">
                            {orchestratorAnalysis.classification.rationale.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-muted">
                        {orchestratorError || "Selecione Rodar agent para gerar a analise do ticket."}
                      </p>
                    )}
                  </div>
                ) : null}

                <div className="filters">
                  <input
                    placeholder="Filtrar mensagens"
                    value={messageSearch}
                    onChange={(event) => setMessageSearch(event.target.value)}
                  />
                </div>

                <div className="support-messages">
                  {filteredMessages.length === 0 ? (
                    <p className="text-muted">Sem mensagens neste canal.</p>
                  ) : (
                    filteredMessages.map((message) => (
                      <div
                        key={message.id || `${message.createdAt}-${message.message}`}
                        className={`support-message-row support-message-${message.senderType || "user"}`}
                      >
                        <strong>{message.senderType || message.senderId || "user"}</strong>
                        <span>{message.message || "-"}</span>
                        <small>{formatDateTime(message.createdAt)}</small>
                      </div>
                    ))
                  )}
                </div>

                <div className="filters">
                  <input
                    placeholder={mode === "chat" ? "Responder chat..." : "Responder ticket..."}
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") sendMessage();
                    }}
                  />
                  <button type="button" onClick={sendMessage}>
                    Enviar
                  </button>
                </div>

                <TechnicalDetails title="Ver payload tecnico do ticket" data={selectedTicket} />
              </div>
            ) : (
              <p>Selecione um ticket.</p>
            )}
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
