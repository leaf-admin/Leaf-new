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
import wsService from "@/src/services/websocket-service";

const OPEN_STATUSES = new Set(["open", "assigned", "in_progress", "escalated"]);
const SUPPORT_POLL_MS = 30000;
const MESSAGE_POLL_MS = 5000;
const SUPPORT_QUICK_REPLIES = [
  "Obrigado pelo contato. Vou verificar isso agora e te retorno por aqui.",
  "Recebemos sua mensagem. Para seguir com segurança, vou transformar este atendimento em chamado.",
  "Conferi aqui e já atualizei o status para acompanhamento.",
];
const N0_QUICK_REPLIES = [
  "Oi! Estou por aqui. Como posso ajudar?",
  "Pode me mandar um pouco mais de detalhe, por favor?",
  "Perfeito, resolvido por aqui. Vou encerrar este atendimento simples.",
];

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

function getChatTitle(chat) {
  return chat?.userInfo?.name || chat?.userName || chat?.userId || "Usuario";
}

function getUserDisplayName(user, fallback = "-") {
  return user?.name || user?.displayName || user?.firstName || user?.fullName || fallback;
}

function getUserType(user) {
  return user?.type || user?.usertype || user?.userType || user?.profileSelection?.userType || "-";
}

function getUserStatus(user) {
  if (!user) return "-";
  if (user.blocked === true) return "blocked";
  if (user.suspended === true) return "suspended";
  if (user.isApproved === true || user.approved === true) return "approved";
  return user.status || user.operationalStatus || "-";
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

function getCopilotPriority(analysis) {
  const value = String(
    analysis?.classification?.priority ||
      analysis?.classification?.supportTier ||
      analysis?.recommendation?.priority ||
      "N3",
  ).toUpperCase();
  return ["N1", "N2", "N3"].includes(value) ? value : "N3";
}

function getCopilotRationale(analysis) {
  const rationale = analysis?.classification?.rationale || analysis?.recommendation?.rationale || [];
  if (Array.isArray(rationale)) return rationale.filter(Boolean);
  if (typeof rationale === "string" && rationale.trim()) return [rationale.trim()];
  return [];
}

function getCopilotSuggestion(analysis) {
  return (
    analysis?.recommendation?.suggestedReply ||
    analysis?.recommendation?.reply ||
    analysis?.recommendation?.n1?.reply ||
    analysis?.recommendation?.n2?.reply ||
    analysis?.recommendation?.n3?.reply ||
    ""
  );
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
  const [chatInbox, setChatInbox] = useState([]);
  const [selectedN0Chat, setSelectedN0Chat] = useState(null);
  const [chatRealtime, setChatRealtime] = useState("polling");
  const [showClosedN0Chats, setShowClosedN0Chats] = useState(false);
  const [supportUserContext, setSupportUserContext] = useState(null);
  const [supportUserContextError, setSupportUserContextError] = useState("");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [n0ChatMessages, setN0ChatMessages] = useState([]);
  const [chatStatus, setChatStatus] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [n0ChatReply, setN0ChatReply] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [ticketSearch, setTicketSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState("");
  const [mode, setMode] = useState("ticket");
  const [orchestratorStatus, setOrchestratorStatus] = useState(null);
  const [orchestratorRuns, setOrchestratorRuns] = useState([]);
  const [orchestratorAnalysis, setOrchestratorAnalysis] = useState(null);
  const [orchestratorLoading, setOrchestratorLoading] = useState(false);
  const [orchestratorError, setOrchestratorError] = useState("");

  const selectedUserId = selectedTicket?.userId || selectedTicket?.user?.id || null;
  const activeContextUserId = selectedN0Chat?.userId || selectedUserId || null;
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

  const loadChatInbox = useCallback(async () => {
    try {
      const response = await leafAPI.getSupportChatInbox({ limit: 80, includeClosed: showClosedN0Chats });
      const nextChats = response?.chats || [];
      setChatInbox(nextChats);
      setSelectedN0Chat((current) => {
        if (!current) return nextChats[0] || null;
        return nextChats.find((chat) => chat.userId === current.userId) || nextChats[0] || null;
      });
    } catch (err) {
      setError(err?.message || "Falha ao carregar chats N0");
    }
  }, [showClosedN0Chats]);

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
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await loadChatInbox();
    };
    run();
    const timer = setInterval(run, MESSAGE_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadChatInbox]);

  useEffect(() => {
    let mounted = true;
    const onNewChatMessage = (message) => {
      if (!message?.userId) return;
      loadChatInbox();
      setN0ChatMessages((current) => {
        if (selectedN0Chat?.userId !== message.userId) return current;
        if (current.some((item) => item.id === message.id)) return current;
        return [...current, message].slice(-80);
      });
    };
    const onChatStatusChange = () => {
      loadChatInbox();
    };

    wsService.on("support:chat:new", onNewChatMessage);
    wsService.on("support:chat:closed", onChatStatusChange);
    wsService.on("support:chat:converted", onChatStatusChange);
    wsService
      .connect()
      .then(() => {
        if (mounted) setChatRealtime("tempo real");
      })
      .catch(() => {
        if (mounted) setChatRealtime("polling");
      });

    return () => {
      mounted = false;
      wsService.off("support:chat:new", onNewChatMessage);
      wsService.off("support:chat:closed", onChatStatusChange);
      wsService.off("support:chat:converted", onChatStatusChange);
    };
  }, [loadChatInbox, selectedN0Chat?.userId]);

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
    if (!selectedN0Chat?.userId) {
      setN0ChatMessages([]);
      return;
    }
    let mounted = true;
    const loadN0Chat = async () => {
      try {
        const includeArchived = showClosedN0Chats || selectedN0Chat.status === "closed";
        const history = await leafAPI.getChatHistory(selectedN0Chat.userId, 80, { includeArchived });
        if (!mounted) return;
        const messages = history?.messages || [];
        setN0ChatMessages(messages);
        if (messages.some((message) => message.senderType === "user" && message.read !== true)) {
          await leafAPI.markChatRead(selectedN0Chat.userId).catch(() => null);
        }
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar chat N0");
      }
    };
    loadN0Chat();
    const timer = setInterval(loadN0Chat, MESSAGE_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedN0Chat?.status, selectedN0Chat?.userId, showClosedN0Chats]);

  useEffect(() => {
    if (!activeContextUserId) {
      setSupportUserContext(null);
      setSupportUserContextError("");
      return;
    }

    let mounted = true;
    const loadContext = async () => {
      try {
        setSupportUserContextError("");
        const data = await leafAPI.getUserDetails(activeContextUserId);
        if (mounted) setSupportUserContext(data || null);
      } catch (err) {
        if (!mounted) return;
        setSupportUserContext(null);
        setSupportUserContextError(err?.message || "Contexto indisponível");
      }
    };

    loadContext();
    return () => {
      mounted = false;
    };
  }, [activeContextUserId]);

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
  const n0UnreadCount = useMemo(
    () => chatInbox.reduce((total, chat) => total + Number(chat?.unreadFromUser || 0), 0),
    [chatInbox],
  );
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
  const copilotPriority = useMemo(() => getCopilotPriority(orchestratorAnalysis), [orchestratorAnalysis]);
  const copilotRationale = useMemo(() => getCopilotRationale(orchestratorAnalysis), [orchestratorAnalysis]);
  const copilotSuggestion = useMemo(() => getCopilotSuggestion(orchestratorAnalysis), [orchestratorAnalysis]);

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
  const activeUserTickets = useMemo(() => {
    if (!activeContextUserId) return [];
    return tickets.filter((ticket) => String(ticket?.userId || ticket?.user?.id || "") === String(activeContextUserId));
  }, [activeContextUserId, tickets]);
  const supportUserDetails = useMemo(() => {
    const latestTicket = activeUserTickets[0] || null;
    return {
      usuario: activeContextUserId || "-",
      nome: getUserDisplayName(supportUserContext, latestTicket?.user?.name || "-"),
      telefone: supportUserContext?.phone || supportUserContext?.mobile || supportUserContext?.phoneNumber || "-",
      email: supportUserContext?.email || "-",
      tipo: getUserType(supportUserContext),
      status: getUserStatus(supportUserContext),
      cidade: supportUserContext?.city || supportUserContext?.cityCode || "-",
      ticketsAbertos: activeUserTickets.filter((ticket) => OPEN_STATUSES.has(normalize(ticket?.status))).length,
      ticketsNaFila: activeUserTickets.length,
      ultimoTicket: latestTicket?.id || "-",
    };
  }, [activeContextUserId, activeUserTickets, supportUserContext]);
  const supportOpsStatus = useMemo(() => {
    const overdue = summary.overdueAckCount + summary.overdueFirstResponseCount;
    if (overdue > 0) {
      return {
        className: "status-bad",
        label: "SLA pede ação",
        detail: `${overdue} item(ns) vencido(s). Priorize antes de abrir novas frentes.`,
      };
    }
    if (summary.ticketsWithoutOwner > 0 || n0UnreadCount > 0) {
      return {
        className: "status-warn",
        label: "Fila em atenção",
        detail: `${summary.ticketsWithoutOwner} ticket(s) sem dono e ${n0UnreadCount} chat(s) N0 nao lido(s).`,
      };
    }
    return {
      className: "status-ok",
      label: "Suporte estável",
      detail: "Sem SLA vencido no snapshot atual.",
    };
  }, [n0UnreadCount, summary]);

  const sendMessage = async () => {
    if (!selectedTicket || !newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage("");
    try {
      setActionBusy("message");
      setError("");
      setActionMessage("");
      if (mode === "chat" && selectedUserId) {
        await leafAPI.sendChatMessage(selectedUserId, text);
        const history = await leafAPI.getChatHistory(selectedUserId, 80);
        setChatMessages(history?.messages || []);
      } else {
        await leafAPI.sendSupportMessage(selectedTicket.id, text);
        const response = await leafAPI.getSupportMessages(selectedTicket.id);
        setTicketMessages(response?.messages || []);
      }
      setActionMessage(mode === "chat" ? "Mensagem enviada no chat." : "Resposta enviada no ticket.");
      await loadTickets({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao enviar mensagem");
      setNewMessage(text);
    } finally {
      setActionBusy("");
    }
  };

  const assignToMe = async () => {
    if (!selectedTicket) return;
    const agentId = user?.id || user?.uid || user?.email || "dashboard-agent";
    const agentName = user?.name || user?.email || agentId;
    try {
      setActionBusy("assign");
      setError("");
      setActionMessage("");
      await leafAPI.assignSupportTicket(selectedTicket.id, agentId, agentName);
      setActionMessage("Ticket atribuído para você.");
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
      setError("");
      setActionMessage("");
      await leafAPI.escalateSupportTicket(selectedTicket.id, reason.trim());
      setActionMessage("Ticket escalado com sucesso.");
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
      setError("");
      setActionMessage("");
      await leafAPI.resolveSupportTicket(selectedTicket.id, resolution.trim());
      setActionMessage("Ticket resolvido com sucesso.");
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
      setActionBusy("close-chat");
      setError("");
      setActionMessage("");
      await leafAPI.closeChat(selectedUserId, "agent");
      const status = await leafAPI.getChatStatus(selectedUserId);
      setChatStatus(status?.status || null);
      setActionMessage("Chat encerrado com sucesso.");
    } catch (err) {
      setError(err?.message || "Falha ao encerrar chat");
    } finally {
      setActionBusy("");
    }
  };

  const sendN0ChatMessage = async () => {
    if (!selectedN0Chat?.userId || !n0ChatReply.trim()) return;
    const text = n0ChatReply.trim();
    setN0ChatReply("");
    try {
      setActionBusy("n0-message");
      setError("");
      setActionMessage("");
      await leafAPI.sendChatMessage(selectedN0Chat.userId, text);
      const history = await leafAPI.getChatHistory(selectedN0Chat.userId, 80);
      setN0ChatMessages(history?.messages || []);
      await loadChatInbox();
      setActionMessage("Mensagem enviada no chat N0.");
    } catch (err) {
      setError(err?.message || "Falha ao responder chat N0");
      setN0ChatReply(text);
    } finally {
      setActionBusy("");
    }
  };

  const convertN0ChatToTicket = async () => {
    if (!selectedN0Chat?.userId) return;
    const subject = window.prompt("Titulo do chamado:", `Atendimento de ${getChatTitle(selectedN0Chat)}`);
    if (subject === null) return;
    const priority = window.prompt("Prioridade do chamado (N1, N2 ou N3):", "N3");
    if (priority === null) return;
    try {
      setActionBusy("n0-convert");
      setError("");
      setActionMessage("");
      const result = await leafAPI.convertChatToTicket(selectedN0Chat.userId, {
        subject: subject.trim() || "Atendimento via chat",
        priority: ["N1", "N2", "N3"].includes(priority.trim().toUpperCase()) ? priority.trim().toUpperCase() : "N3",
        category: "chat",
        metadata: {
          source: "dashboard_n0_chat"
        }
      });
      await Promise.all([loadTickets({ silent: true }), loadChatInbox()]);
      if (result?.ticket) {
        setSelectedTicket(result.ticket);
        setMode("ticket");
      }
      setActionMessage(`Chat convertido em chamado ${result?.ticket?.id || ""}.`.trim());
    } catch (err) {
      setError(err?.message || "Falha ao converter chat em chamado");
    } finally {
      setActionBusy("");
    }
  };

  const closeN0Chat = async () => {
    if (!selectedN0Chat?.userId) return;
    if (!window.confirm("Encerrar este atendimento simples?")) return;
    try {
      setActionBusy("n0-close");
      setError("");
      setActionMessage("");
      await leafAPI.closeChat(selectedN0Chat.userId, "agent");
      await loadChatInbox();
      setActionMessage("Chat N0 encerrado e historico arquivado.");
    } catch (err) {
      setError(err?.message || "Falha ao encerrar chat N0");
    } finally {
      setActionBusy("");
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

  const applyCopilotInternalNote = async () => {
    if (!orchestratorAnalysis?.id || !selectedTicket?.id || !orchestratorEnabled) return;
    const suggested = copilotSuggestion || "Registrar triagem do copiloto para revisao humana.";
    const message = window.prompt("Nota interna para registrar no ticket:", suggested);
    if (message === null) return;
    try {
      setActionBusy("copilot-note");
      setError("");
      setActionMessage("");
      await leafAPI.applySupportOrchestratorAction(orchestratorAnalysis.id, {
        action: "internal_note",
        approvedBy: user?.email || user?.id || user?.name || "dashboard-agent",
        message: message.trim(),
        idempotencyKey: `${orchestratorAnalysis.id}:internal_note:${selectedTicket.id}:${message.trim()}`,
      });
      const response = await leafAPI.getSupportOrchestratorTicketAnalysis(selectedTicket.id);
      setOrchestratorAnalysis(response?.analysis || null);
      await Promise.all([
        loadOrchestratorOverview(),
        leafAPI.getSupportMessages(selectedTicket.id).then((data) => setTicketMessages(data?.messages || [])).catch(() => null),
      ]);
      setActionMessage("Nota interna aplicada pelo orquestrador com aprovacao humana.");
    } catch (err) {
      setError(err?.message || "Falha ao aplicar nota interna do copiloto");
    } finally {
      setActionBusy("");
    }
  };

  const applyCopilotEscalation = async () => {
    if (!orchestratorAnalysis?.id || !selectedTicket?.id || !orchestratorEnabled) return;
    const reason = window.prompt("Motivo da escalacao:", copilotRationale[0] || "Escalado apos revisao humana do copiloto.");
    if (reason === null) return;
    try {
      setActionBusy("copilot-escalate");
      setError("");
      setActionMessage("");
      await leafAPI.applySupportOrchestratorAction(orchestratorAnalysis.id, {
        action: "escalate_ticket",
        approvedBy: user?.email || user?.id || user?.name || "dashboard-agent",
        reason: reason.trim(),
        idempotencyKey: `${orchestratorAnalysis.id}:escalate:${selectedTicket.id}:${reason.trim()}`,
      });
      const response = await leafAPI.getSupportOrchestratorTicketAnalysis(selectedTicket.id);
      setOrchestratorAnalysis(response?.analysis || null);
      await Promise.all([loadTickets({ silent: true }), loadOrchestratorOverview()]);
      setActionMessage("Ticket escalado pelo orquestrador com aprovacao humana.");
    } catch (err) {
      setError(err?.message || "Falha ao escalar com copiloto");
    } finally {
      setActionBusy("");
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
          <KpiCard title="Chats N0" value={chatInbox.length} subtitle="atendimentos simples" />
          <KpiCard title="Nao lidas N0" value={n0UnreadCount} tone={n0UnreadCount > 0 ? "warning" : "positive"} />
          <KpiCard title="Chat" value={chatRealtime} subtitle="notificacoes" />
        </section>

        <section className="grid orchestrator-grid">
          <Panel
            title="Status operacional"
            subtitle="Leitura rápida para decidir se o atendimento segue no N0 ou vira chamado."
          >
            <div className="orchestrator-summary">
              <span className={supportOpsStatus.className}>{supportOpsStatus.label}</span>
              <span className="meta-badge">chat: {chatRealtime}</span>
              <span className="meta-badge">polling tickets: {SUPPORT_POLL_MS / 1000}s</span>
              <span className="meta-badge">polling mensagens: {MESSAGE_POLL_MS / 1000}s</span>
            </div>
            <p className="text-muted">{supportOpsStatus.detail}</p>
            <div className="metric-list">
              <div className="row">
                <div className="label">Quando virar chamado</div>
                <div className="value">caso precise dono, SLA, histórico longo ou N2/N3</div>
              </div>
              <div className="row">
                <div className="label">Quando manter N0</div>
                <div className="value">dúvida simples, orientação rápida ou resposta única</div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Copiloto de suporte"
            subtitle={
              orchestratorEnabled
                ? "Sugestoes internas conectadas ao playbook, tickets e contexto operacional. Atendimento e envio seguem manuais."
                : "Pronto para receber o servico externo quando NEXT_PUBLIC_SUPPORT_ORCHESTRATOR_URL estiver configurado."
            }
            actions={
              orchestratorEnabled ? (
                <button type="button" onClick={loadOrchestratorOverview}>
                  Atualizar copiloto
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
              <span className="meta-badge">envio automatico: bloqueado</span>
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

        <section className="grid orchestrator-grid">
          <Panel
            title="Contexto do usuário"
            subtitle="Dados essenciais para decidir rápido sem sair do atendimento."
            actions={
              activeContextUserId ? (
                <a href={`/users/${activeContextUserId}`}>
                  Abrir perfil
                </a>
              ) : null
            }
          >
            {activeContextUserId ? (
              <div className="section-stack">
                <KeyValueGrid
                  data={supportUserDetails}
                  labels={{
                    usuario: "Usuário",
                    nome: "Nome",
                    telefone: "Telefone",
                    email: "E-mail",
                    tipo: "Tipo",
                    status: "Status",
                    cidade: "Cidade",
                    ticketsAbertos: "Tickets abertos",
                    ticketsNaFila: "Tickets na fila",
                    ultimoTicket: "Último ticket",
                  }}
                  maxItems={10}
                />
                {supportUserContextError ? (
                  <p className="text-muted">
                    Perfil completo indisponível agora. Mantive o contexto vindo da fila/chat.
                  </p>
                ) : null}
                {activeUserTickets.length > 0 ? (
                  <div className="orchestrator-summary">
                    {activeUserTickets.slice(0, 4).map((ticket) => (
                      <span key={ticket.id} className={statusBadge(ticket.status)}>
                        {ticket.id}: {ticket.status || "open"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted">Sem tickets recentes carregados para este usuário.</p>
                )}
              </div>
            ) : (
              <p className="text-muted">Selecione um ticket ou chat para ver o contexto.</p>
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
                      Gerar sugestao
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
                      <strong>Copiloto de suporte</strong>
                      {orchestratorLoading ? <span className="meta-badge">analisando</span> : null}
                      <span className="meta-badge">sugestao interna</span>
                      <span className="status-warn">humano obrigatorio</span>
                      {orchestratorAnalysis?.classification ? (
                        <>
                          <span className={priorityBadge(copilotPriority)}>{copilotPriority}</span>
                          <span className="meta-badge">{orchestratorAnalysis.classification.supportTier}</span>
                          <span className={confidenceBadge(orchestratorAnalysis.classification.confidence)}>
                            {formatConfidence(orchestratorAnalysis.classification.confidence)}
                          </span>
                        </>
                      ) : null}
                    </div>

                    {orchestratorAnalysis?.recommendation ? (
                      <>
                        <p className="text-muted">
                          Sugestao para triagem. Revise o contexto, ajuste o texto e envie manualmente pelo atendimento.
                        </p>
                        <p>{copilotSuggestion || "Sem rascunho sugerido para este ticket."}</p>
                        <div className="orchestrator-summary">
                          <span className={priorityBadge(copilotPriority)}>prioridade: {copilotPriority}</span>
                          <span className="meta-badge">acao sugerida: {orchestratorAnalysis.recommendation.nextAction || "-"}</span>
                          <span className="meta-badge">categoria: {orchestratorAnalysis.classification?.category || "-"}</span>
                          <span className="status-warn">humano obrigatorio: sim</span>
                          <span className="meta-badge">
                            web search: {orchestratorAnalysis.audit?.internetSearchUsed ? "sim" : "nao"}
                          </span>
                        </div>
                        {copilotRationale.length ? (
                          <ul className="agent-rationale">
                            {copilotRationale.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="filters">
                          <button
                            type="button"
                            disabled={actionBusy === "copilot-note" || !orchestratorAnalysis?.id}
                            onClick={applyCopilotInternalNote}
                          >
                            {actionBusy === "copilot-note" ? "Aplicando..." : "Registrar nota interna"}
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy === "copilot-escalate" || !orchestratorAnalysis?.id}
                            onClick={applyCopilotEscalation}
                          >
                            {actionBusy === "copilot-escalate" ? "Escalando..." : "Escalar com aprovacao"}
                          </button>
                        </div>
                        {Array.isArray(orchestratorAnalysis.actions) && orchestratorAnalysis.actions.length ? (
                          <div className="orchestrator-summary">
                            {orchestratorAnalysis.actions.slice(0, 3).map((action) => (
                              <span key={action.id} className={action.status === "succeeded" ? "status-ok" : "status-warn"}>
                                {action.type}: {action.status}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-muted">
                        {orchestratorError ||
                          "Selecione Gerar sugestao para consultar o copiloto. O suporte manual continua disponivel."}
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
                  <div className="quick-reply-row">
                    {SUPPORT_QUICK_REPLIES.map((template) => (
                      <button key={template} type="button" onClick={() => setNewMessage(template)}>
                        {template}
                      </button>
                    ))}
                  </div>
                  <input
                    placeholder={mode === "chat" ? "Responder chat..." : "Responder ticket..."}
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") sendMessage();
                    }}
                  />
                  <button type="button" onClick={sendMessage} disabled={!!actionBusy || !newMessage.trim()}>
                    {actionBusy === "message" ? "Enviando..." : "Enviar"}
                  </button>
                </div>

                <TechnicalDetails title="Ver payload tecnico do ticket" data={selectedTicket} />
              </div>
            ) : (
              <p>Selecione um ticket.</p>
            )}
          </Panel>
        </section>

        <section className="grid support-grid">
          <Panel
            title="Chats N0"
            subtitle="Atendimentos simples antes de virar chamado."
            actions={
              <>
                <label className="meta-badge">
                  <input
                    type="checkbox"
                    checked={showClosedN0Chats}
                    onChange={(event) => setShowClosedN0Chats(event.target.checked)}
                  />
                  Arquivados
                </label>
                <button type="button" onClick={loadChatInbox} disabled={actionBusy === "n0-refresh"}>
                  Atualizar chats
                </button>
              </>
            }
          >
            <div className="support-list">
              {chatInbox.map((chat) => (
                <button
                  key={chat.userId}
                  type="button"
                  className={selectedN0Chat?.userId === chat.userId ? "ticket-btn ticket-btn-active" : "ticket-btn"}
                  onClick={() => setSelectedN0Chat(chat)}
                >
                  <strong>{getChatTitle(chat)}</strong>
                  <span className="ticket-meta-row">
                    <span className={chat.status === "active" ? "status-ok" : "status-warn"}>{chat.status || "active"}</span>
                    <span className={chat.unreadFromUser > 0 ? "status-warn" : "meta-badge"}>
                      {chat.unreadFromUser || 0} nao lida(s)
                    </span>
                    {chat.ticketId ? <span className="meta-badge">ticket {chat.ticketId}</span> : null}
                  </span>
                  <span>{chat.lastMessage?.message || "Sem mensagem recente."}</span>
                  <span className="table-muted">
                    {formatDateTime(chat.lastMessageAt || chat.updatedAt)}
                    {chat.messageCount ? ` • ${chat.messageCount} msg` : ""}
                  </span>
                </button>
              ))}
              {chatInbox.length === 0 ? (
                <p className="text-muted">Nenhum chat N0 ativo neste momento.</p>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Atendimento N0"
            subtitle="Resolva pedidos simples no chat ou transforme em chamado quando precisar acompanhar."
            actions={
              selectedN0Chat ? (
                <>
                  <button type="button" disabled={!!actionBusy} onClick={convertN0ChatToTicket}>
                    Transformar em chamado
                  </button>
                  <button type="button" disabled={!!actionBusy || selectedN0Chat.status === "closed"} onClick={closeN0Chat}>
                    Encerrar
                  </button>
                </>
              ) : null
            }
          >
            {selectedN0Chat ? (
              <div className="section-stack">
                <KeyValueGrid
                  data={{
                    usuario: selectedN0Chat.userId,
                    status: selectedN0Chat.status || "active",
                    ticket: selectedN0Chat.ticketId || "sem chamado",
                    mensagens: selectedN0Chat.messageCount || 0,
                    naoLidas: selectedN0Chat.unreadFromUser || 0,
                    ultimaMensagem: formatDateTime(selectedN0Chat.lastMessageAt || selectedN0Chat.updatedAt),
                  }}
                  labels={{
                    usuario: "Usuario",
                    status: "Status",
                    ticket: "Chamado",
                    mensagens: "Mensagens",
                    naoLidas: "Nao lidas",
                    ultimaMensagem: "Ultima mensagem",
                  }}
                  maxItems={6}
                />

                <div className="support-messages">
                  {n0ChatMessages.length === 0 ? (
                    <p className="text-muted">Sem histórico neste chat.</p>
                  ) : (
                    n0ChatMessages.map((message) => (
                      <div
                        key={message.id || `${message.createdAt}-${message.message}`}
                        className={`support-message-row support-message-${message.senderType || "user"}`}
                      >
                        <strong>{message.senderType === "agent" ? "Suporte" : "Usuario"}</strong>
                        <span>{message.message || "-"}</span>
                        <small>{formatDateTime(message.createdAt || message.timestamp)}</small>
                      </div>
                    ))
                  )}
                </div>

                <div className="filters">
                  <div className="quick-reply-row">
                    {N0_QUICK_REPLIES.map((template) => (
                      <button key={template} type="button" onClick={() => setN0ChatReply(template)}>
                        {template}
                      </button>
                    ))}
                  </div>
                  <input
                    placeholder="Responder atendimento simples..."
                    value={n0ChatReply}
                    onChange={(event) => setN0ChatReply(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") sendN0ChatMessage();
                    }}
                  />
                  <button type="button" onClick={sendN0ChatMessage} disabled={!!actionBusy || !n0ChatReply.trim()}>
                    {actionBusy === "n0-message" ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-muted">Selecione um chat N0.</p>
            )}
          </Panel>
        </section>
        {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
