"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import wsService from "@/src/services/websocket-service";
import { normalizeRole } from "@/src/utils/dashboard-access";

const OPEN_STATUSES = new Set(["open", "assigned", "in_progress", "escalated"]);
const SUPPORT_POLL_MS = 60000;
const MESSAGE_POLL_MS = 30000;
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
const SUPPORT_TIERS = ["N1", "N2", "N3"];
const SUPPORT_ACTIONS = {
  assign: "assumir",
  message: "responder",
  resolve: "resolver",
  escalate: "escalar",
  copilot_note: "registrar nota do copiloto",
  copilot_escalate: "escalar com copiloto",
  convert_n0: "converter N0",
  close_chat: "encerrar chat",
};
const FULL_SUPPORT_ACTIONS = Object.keys(SUPPORT_ACTIONS);
const N1_SUPPORT_ACTIONS = [
  "assign",
  "message",
  "resolve",
  "escalate",
  "copilot_note",
  "copilot_escalate",
  "convert_n0",
  "close_chat",
];
const N2_SUPPORT_ACTIONS = N1_SUPPORT_ACTIONS;
const SUPPORT_ROLE_POLICIES = {
  "super-admin": {
    label: "Super admin",
    tiers: SUPPORT_TIERS,
    actions: FULL_SUPPORT_ACTIONS,
  },
  admin: {
    label: "Admin",
    tiers: SUPPORT_TIERS,
    actions: FULL_SUPPORT_ACTIONS,
  },
  manager: {
    label: "Gestão",
    tiers: SUPPORT_TIERS,
    actions: FULL_SUPPORT_ACTIONS,
  },
  development: {
    label: "Desenvolvimento",
    tiers: SUPPORT_TIERS,
    actions: FULL_SUPPORT_ACTIONS,
  },
  support_n1: {
    label: "Suporte N1",
    tiers: ["N1"],
    actions: N1_SUPPORT_ACTIONS,
  },
  support_n2: {
    label: "Suporte N2",
    tiers: ["N1", "N2"],
    actions: N2_SUPPORT_ACTIONS,
  },
  support_n3: {
    label: "Suporte N3",
    tiers: SUPPORT_TIERS,
    actions: FULL_SUPPORT_ACTIONS,
  },
  support: {
    label: "Suporte N1",
    tiers: ["N1"],
    actions: N1_SUPPORT_ACTIONS,
  },
};
const READ_ONLY_SUPPORT_POLICY = {
  label: "Somente leitura",
  tiers: [],
  actions: [],
};
const DEFAULT_N0_TICKET_FORM = {
  subject: "",
  priority: "N3",
  category: "chat",
  description: "",
};

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

function resolveSupportTier(value, fallback = "N3") {
  const normalized = String(value || fallback || "N3").trim().toUpperCase();
  return SUPPORT_TIERS.includes(normalized) ? normalized : fallback;
}

function getSupportPolicy(user) {
  const rawRole = normalizeRole(user?.role);
  const role = rawRole.replace(/-/g, "_");
  const policy = SUPPORT_ROLE_POLICIES[rawRole] || SUPPORT_ROLE_POLICIES[role];
  if (policy) return { ...policy, role: rawRole || "unknown" };
  if (rawRole.includes("support") || rawRole.includes("suporte")) {
    return { ...SUPPORT_ROLE_POLICIES.support, role: rawRole };
  }
  return { ...READ_ONLY_SUPPORT_POLICY, role: rawRole || "unknown" };
}

function canRunSupportAction(policy, action, tier) {
  if (!policy?.actions?.includes(action)) return false;
  const resolvedTier = tier ? resolveSupportTier(tier) : null;
  if (!resolvedTier) return true;
  return policy?.tiers?.includes(resolvedTier);
}

function supportActionBlockReason(policy, action, tier) {
  const label = SUPPORT_ACTIONS[action] || "executar esta ação";
  if (!policy?.actions?.includes(action)) {
    return `Perfil ${policy?.label || "atual"} não pode ${label}.`;
  }
  const resolvedTier = tier ? resolveSupportTier(tier) : null;
  if (resolvedTier && !policy?.tiers?.includes(resolvedTier)) {
    return `Perfil ${policy?.label || "atual"} não opera chamados ${resolvedTier}.`;
  }
  return "";
}

function buildIdempotencyKey(parts) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(":")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 180);
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

function auditSeverityClass(severity, success = true) {
  const normalized = String(severity || "").toUpperCase();
  if (success === false || ["ERROR", "CRITICAL"].includes(normalized)) return "status-bad";
  if (normalized === "WARNING") return "status-warn";
  return "status-ok";
}

function getAuditActionLabel(log) {
  return log?.action || log?.event || log?.type || "ação registrada";
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

function getN0ConversionGaps(chat, messages = []) {
  if (!chat?.userId || chat?.ticketId) return [];
  const gaps = [];
  const unread = Number(chat.unreadFromUser || 0);
  const messageCount = Number(chat.messageCount || messages.length || 0);
  const userMessages = messages.filter((message) => message.senderType !== "agent").length;

  if (unread > 0) gaps.push(`${unread} mensagem(ns) do usuário sem resposta`);
  if (messageCount >= 3 || userMessages >= 2) gaps.push("histórico maior que atendimento simples");
  if (chat.status !== "closed") gaps.push("sem dono e sem SLA de ticket");
  if (!gaps.length) gaps.push("chat sem chamado vinculado");
  return gaps;
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
  const chatRealtimeRef = useRef(false);
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
  const [inboxFilter, setInboxFilter] = useState("all");
  const [orchestratorStatus, setOrchestratorStatus] = useState(null);
  const [orchestratorRuns, setOrchestratorRuns] = useState([]);
  const [orchestratorAnalysis, setOrchestratorAnalysis] = useState(null);
  const [orchestratorLoading, setOrchestratorLoading] = useState(false);
  const [orchestratorError, setOrchestratorError] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditError, setAuditError] = useState("");
  const [manualEscalationReason, setManualEscalationReason] = useState("");
  const [manualResolution, setManualResolution] = useState("");
  const [copilotNoteDraft, setCopilotNoteDraft] = useState("");
  const [copilotEscalationReason, setCopilotEscalationReason] = useState("");
  const [n0TicketForm, setN0TicketForm] = useState(DEFAULT_N0_TICKET_FORM);

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

  const loadSupportAudit = useCallback(async () => {
    try {
      const response = await leafAPI.listAuditLogs({ resource: "support", limit: 12 });
      setAuditLogs(response?.logs || []);
      setAuditError("");
    } catch (err) {
      setAuditLogs([]);
      setAuditError(err?.message || "Auditoria indisponível para este perfil.");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async (options) => {
      if (!mounted) return;
      await loadTickets(options);
    };
    run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") run({ silent: true });
    }, SUPPORT_POLL_MS);
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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !chatRealtimeRef.current) run();
    }, MESSAGE_POLL_MS);
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
    const onRealtimeReady = () => {
      chatRealtimeRef.current = true;
      if (mounted) setChatRealtime("tempo real");
    };
    const onRealtimeUnavailable = () => {
      chatRealtimeRef.current = false;
      if (mounted) setChatRealtime("polling");
    };

    wsService.on("support:chat:new", onNewChatMessage);
    wsService.on("support:chat:closed", onChatStatusChange);
    wsService.on("support:chat:converted", onChatStatusChange);
    wsService.on("authenticated", onRealtimeReady);
    wsService.on("disconnect", onRealtimeUnavailable);
    wsService
      .connect()
      .then(onRealtimeReady)
      .catch(onRealtimeUnavailable);

    return () => {
      mounted = false;
      chatRealtimeRef.current = false;
      wsService.off("support:chat:new", onNewChatMessage);
      wsService.off("support:chat:closed", onChatStatusChange);
      wsService.off("support:chat:converted", onChatStatusChange);
      wsService.off("authenticated", onRealtimeReady);
      wsService.off("disconnect", onRealtimeUnavailable);
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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, SUPPORT_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadOrchestratorOverview, orchestratorEnabled]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await loadSupportAudit();
    };
    run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, SUPPORT_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadSupportAudit]);

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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadTicketMessages();
      }
    }, MESSAGE_POLL_MS);
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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadChatData();
      }
    }, MESSAGE_POLL_MS);
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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !chatRealtimeRef.current) {
        loadN0Chat();
      }
    }, MESSAGE_POLL_MS);
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
    () => {
      if (mode === "n0") return n0ChatMessages;
      return mode === "ticket" ? ticketMessages : chatMessages;
    },
    [chatMessages, mode, n0ChatMessages, ticketMessages],
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
  const inboxItems = useMemo(() => {
    const searchTerm = ticketSearch.trim().toLowerCase();
    const ticketItems = tickets.map((ticket) => {
      const health = queueHealthBadge(ticket);
      return {
        id: `ticket:${ticket.id}`,
        type: "ticket",
        title: getTicketTitle(ticket),
        subtitle: ticket.user?.name || ticket.userId || "Usuário sem identificação",
        preview: getTicketDescription(ticket) || ticket.category || "Chamado sem mensagem recente.",
        timestamp: ticket.updatedAt || ticket.createdAt,
        unread: ticket.queue?.overdueFirstResponse || ticket.queue?.overdueAck ? 1 : 0,
        priority: ticket.priority || "N3",
        status: ticket.status || "open",
        tone: health.className,
        badge: health.label,
        raw: ticket,
      };
    });
    const chatItems = chatInbox.map((chat) => ({
      id: `chat:${chat.userId}`,
      type: "n0",
      title: getChatTitle(chat),
      subtitle: chat.userId || "Chat N0",
      preview: chat.lastMessage?.message || "Sem mensagem recente.",
      timestamp: chat.lastMessageAt || chat.updatedAt,
      unread: Number(chat.unreadFromUser || 0),
      priority: chat.ticketId ? "N2" : "N3",
      status: chat.status || "active",
      tone: chat.unreadFromUser > 0 ? "status-warn" : "status-ok",
      badge: chat.ticketId ? "com chamado" : "chat",
      raw: chat,
    }));
    return [...chatItems, ...ticketItems]
      .filter((item) => {
        if (inboxFilter === "chats" && item.type !== "n0") return false;
        if (inboxFilter === "tickets" && item.type !== "ticket") return false;
        if (!searchTerm) return true;
        return [item.title, item.subtitle, item.preview, item.status, item.priority]
          .join(" ")
          .toLowerCase()
          .includes(searchTerm);
      })
      .sort((left, right) => {
        const unreadDelta = Number(right.unread > 0) - Number(left.unread > 0);
        if (unreadDelta !== 0) return unreadDelta;
        return new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime();
      });
  }, [chatInbox, inboxFilter, ticketSearch, tickets]);
  const selectedInboxId = mode === "n0"
    ? (selectedN0Chat?.userId ? `chat:${selectedN0Chat.userId}` : "")
    : (selectedTicket?.id ? `ticket:${selectedTicket.id}` : "");
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
  const supportPolicy = useMemo(() => getSupportPolicy(user), [user]);
  const selectedTicketTier = useMemo(
    () => resolveSupportTier(selectedTicket?.priority || copilotPriority),
    [copilotPriority, selectedTicket?.priority],
  );
  const selectedN0Priority = useMemo(() => resolveSupportTier(n0TicketForm.priority), [n0TicketForm.priority]);
  const n0ConversionGaps = useMemo(
    () => getN0ConversionGaps(selectedN0Chat, n0ChatMessages),
    [n0ChatMessages, selectedN0Chat],
  );
  const selectedN0ChatTitle = useMemo(
    () => (selectedN0Chat ? getChatTitle(selectedN0Chat) : ""),
    [selectedN0Chat],
  );
  const canAssignSelected = canRunSupportAction(supportPolicy, "assign", selectedTicketTier);
  const canMessageSelected = canRunSupportAction(supportPolicy, "message", selectedTicketTier);
  const canResolveSelected = canRunSupportAction(supportPolicy, "resolve", selectedTicketTier);
  const canEscalateSelected = canRunSupportAction(supportPolicy, "escalate", selectedTicketTier);
  const canApplyCopilotNote = canRunSupportAction(supportPolicy, "copilot_note", selectedTicketTier);
  const canApplyCopilotEscalation = canRunSupportAction(supportPolicy, "copilot_escalate", selectedTicketTier);
  const canConvertSelectedN0 =
    selectedN0Chat?.userId &&
    !selectedN0Chat?.ticketId &&
    n0ConversionGaps.length > 0 &&
    canRunSupportAction(supportPolicy, "convert_n0", selectedN0Priority);
  const activeThreadTitle = mode === "n0"
    ? selectedN0ChatTitle
    : mode === "chat"
      ? `${selectedTicket?.user?.name || selectedTicket?.userId || "Usuário"}`
      : getTicketTitle(selectedTicket);
  const activeThreadSubtitle = mode === "n0"
    ? `${selectedN0Chat?.status || "active"} · ${selectedN0Chat?.unreadFromUser || 0} não lida(s)`
    : `${selectedTicket?.priority || "N3"} · ${selectedTicket?.status || "open"} · ${selectedTicket?.userId || "sem usuário"}`;
  const replyValue = mode === "n0" ? n0ChatReply : newMessage;
  const canReplyActiveThread = mode === "n0"
    ? canRunSupportAction(supportPolicy, "message", "N3")
    : canMessageSelected;
  const selectInboxItem = (item) => {
    setError("");
    setActionMessage("");
    if (item.type === "n0") {
      setSelectedN0Chat(item.raw);
      setMode("n0");
      return;
    }
    setSelectedTicket(item.raw);
    setMode("ticket");
  };
  const updateActiveReply = (value) => {
    if (mode === "n0") {
      setN0ChatReply(value);
      return;
    }
    setNewMessage(value);
  };
  const sendActiveReply = () => {
    if (mode === "n0") {
      sendN0ChatMessage();
      return;
    }
    sendMessage();
  };
  const copilotInternalNoteKey = useMemo(
    () =>
      buildIdempotencyKey([
        "support-copilot",
        orchestratorAnalysis?.id,
        selectedTicket?.id,
        "internal-note",
        copilotNoteDraft,
      ]),
    [copilotNoteDraft, orchestratorAnalysis?.id, selectedTicket?.id],
  );
  const copilotEscalationKey = useMemo(
    () =>
      buildIdempotencyKey([
        "support-copilot",
        orchestratorAnalysis?.id,
        selectedTicket?.id,
        "escalate",
        copilotEscalationReason,
      ]),
    [copilotEscalationReason, orchestratorAnalysis?.id, selectedTicket?.id],
  );
  const n0ConversionKey = useMemo(
    () =>
      buildIdempotencyKey([
        "support-n0",
        selectedN0Chat?.userId,
        selectedN0Chat?.lastMessageAt || selectedN0Chat?.updatedAt,
        "convert-ticket",
        n0TicketForm.subject,
        selectedN0Priority,
      ]),
    [
      n0TicketForm.subject,
      selectedN0Chat?.lastMessageAt,
      selectedN0Chat?.updatedAt,
      selectedN0Chat?.userId,
      selectedN0Priority,
    ],
  );
  const recentActionItems = useMemo(() => {
    const auditItems = auditLogs.map((log) => ({
      id: `audit-${log.id || log.createdAt || getAuditActionLabel(log)}`,
      type: "Auditoria",
      label: getAuditActionLabel(log),
      status: log.success === false ? "falhou" : log.severity || "ok",
      className: auditSeverityClass(log.severity, log.success),
      at: log.createdAt || log.timestamp,
      detail: log.resource || log.resourceId || log.userId || "-",
    }));
    const runItems = orchestratorRuns.map((run) => ({
      id: `run-${run.id}`,
      type: "Copiloto",
      label: run.classification?.category || run.source || "triagem",
      status: run.classification?.supportTier || "-",
      className: confidenceBadge(run.classification?.confidence),
      at: run.createdAt || run.updatedAt,
      detail: run.ticketId || run.userId || "-",
    }));
    const actionItems = Array.isArray(orchestratorAnalysis?.actions)
      ? orchestratorAnalysis.actions.map((action) => ({
          id: `copilot-action-${action.id || action.type}`,
          type: "Ação aprovada",
          label: action.type || action.action || "ação",
          status: action.status || "-",
          className: action.status === "succeeded" ? "status-ok" : "status-warn",
          at: action.createdAt || action.updatedAt,
          detail: selectedTicket?.id || "-",
        }))
      : [];

    return [...actionItems, ...auditItems, ...runItems]
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .slice(0, 8);
  }, [auditLogs, orchestratorAnalysis?.actions, orchestratorRuns, selectedTicket?.id]);

  useEffect(() => {
    if (!selectedTicket?.id) {
      setManualEscalationReason("");
      setManualResolution("");
      return;
    }
    setManualEscalationReason(copilotRationale[0] || "");
    setManualResolution("");
  }, [copilotRationale, selectedTicket?.id]);

  useEffect(() => {
    if (!selectedTicket?.id) {
      setCopilotNoteDraft("");
      setCopilotEscalationReason("");
      return;
    }
    setCopilotNoteDraft(copilotSuggestion || "Triagem revisada. Sem resposta automática enviada ao usuário.");
    setCopilotEscalationReason(copilotRationale[0] || "Escalado após revisão humana do copiloto.");
  }, [copilotRationale, copilotSuggestion, selectedTicket?.id]);

  useEffect(() => {
    if (!selectedN0Chat?.userId) {
      setN0TicketForm(DEFAULT_N0_TICKET_FORM);
      return;
    }
    setN0TicketForm({
      subject: `Atendimento de ${selectedN0ChatTitle || selectedN0Chat.userId}`,
      priority: "N3",
      category: "chat",
      description: selectedN0Chat.lastMessage?.message || "",
    });
  }, [selectedN0Chat?.lastMessage?.message, selectedN0Chat?.userId, selectedN0ChatTitle]);

  const sendMessage = async () => {
    if (!selectedTicket || !newMessage.trim()) return;
    if (!canMessageSelected) {
      setError(supportActionBlockReason(supportPolicy, "message", selectedTicketTier));
      return;
    }
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
    if (!canAssignSelected) {
      setError(supportActionBlockReason(supportPolicy, "assign", selectedTicketTier));
      return;
    }
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
    if (!canEscalateSelected) {
      setError(supportActionBlockReason(supportPolicy, "escalate", selectedTicketTier));
      return;
    }
    const reason = manualEscalationReason.trim();
    if (!reason) {
      setError("Informe o motivo antes de escalar.");
      return;
    }
    try {
      setActionBusy("escalate");
      setError("");
      setActionMessage("");
      await leafAPI.escalateSupportTicket(selectedTicket.id, reason);
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
    if (!canResolveSelected) {
      setError(supportActionBlockReason(supportPolicy, "resolve", selectedTicketTier));
      return;
    }
    const resolution = manualResolution.trim();
    if (!resolution) {
      setError("Informe um resumo curto da resolução antes de finalizar.");
      return;
    }
    try {
      setActionBusy("resolve");
      setError("");
      setActionMessage("");
      await leafAPI.resolveSupportTicket(selectedTicket.id, resolution);
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
    if (!canRunSupportAction(supportPolicy, "close_chat", selectedTicketTier)) {
      setError(supportActionBlockReason(supportPolicy, "close_chat", selectedTicketTier));
      return;
    }
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
    if (!canRunSupportAction(supportPolicy, "message", "N3")) {
      setError(supportActionBlockReason(supportPolicy, "message", "N3"));
      return;
    }
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
    if (!canConvertSelectedN0) {
      setError(
        selectedN0Chat?.ticketId
          ? "Este chat já tem chamado vinculado."
          : supportActionBlockReason(supportPolicy, "convert_n0", selectedN0Priority),
      );
      return;
    }
    const subject = n0TicketForm.subject.trim() || "Atendimento via chat";
    const description = n0TicketForm.description.trim() || selectedN0Chat.lastMessage?.message || "Chat convertido para acompanhamento.";
    try {
      setActionBusy("n0-convert");
      setError("");
      setActionMessage("");
      const result = await leafAPI.convertChatToTicket(selectedN0Chat.userId, {
        subject,
        description,
        priority: selectedN0Priority,
        category: n0TicketForm.category.trim() || "chat",
        metadata: {
          source: "dashboard_n0_chat",
          gapReasons: n0ConversionGaps,
          convertedBy: user?.email || user?.id || user?.name || "dashboard-agent",
        },
        idempotencyKey: n0ConversionKey,
      }, { idempotencyKey: n0ConversionKey });
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
    if (!canRunSupportAction(supportPolicy, "close_chat", "N3")) {
      setError(supportActionBlockReason(supportPolicy, "close_chat", "N3"));
      return;
    }
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
    if (!canApplyCopilotNote) {
      setError(supportActionBlockReason(supportPolicy, "copilot_note", selectedTicketTier));
      return;
    }
    const message = copilotNoteDraft.trim();
    if (!message) {
      setError("Revise e confirme a nota interna antes de aplicar.");
      return;
    }
    try {
      setActionBusy("copilot-note");
      setError("");
      setActionMessage("");
      await leafAPI.applySupportOrchestratorAction(orchestratorAnalysis.id, {
        action: "internal_note",
        approvedBy: user?.email || user?.id || user?.name || "dashboard-agent",
        message,
        ticketId: selectedTicket.id,
        idempotencyKey: copilotInternalNoteKey,
      }, { idempotencyKey: copilotInternalNoteKey });
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
    if (!canApplyCopilotEscalation) {
      setError(supportActionBlockReason(supportPolicy, "copilot_escalate", selectedTicketTier));
      return;
    }
    const reason = copilotEscalationReason.trim();
    if (!reason) {
      setError("Informe o motivo aprovado para escalar com o copiloto.");
      return;
    }
    try {
      setActionBusy("copilot-escalate");
      setError("");
      setActionMessage("");
      await leafAPI.applySupportOrchestratorAction(orchestratorAnalysis.id, {
        action: "escalate_ticket",
        approvedBy: user?.email || user?.id || user?.name || "dashboard-agent",
        reason,
        ticketId: selectedTicket.id,
        targetTier: copilotPriority,
        idempotencyKey: copilotEscalationKey,
      }, { idempotencyKey: copilotEscalationKey });
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
      <main className="page-shell support-page-shell">
        <header className="header support-header">
          <div>
            <h1>Suporte</h1>
            <p>Fila operacional N1/N2/N3 com SLA, ownership, ticket e chat.</p>
          </div>
          <div className="filters support-header-filters">
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

        <section className="grid grid-kpi support-kpi-strip">
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

        <section className="support-inbox-layout">
          <aside className="support-inbox-panel card">
            <div className="support-inbox-head">
              <div>
                <h2>Inbox</h2>
                <p>Chats e chamados em ordem de atenção.</p>
              </div>
              <span className={n0UnreadCount > 0 ? "status-warn" : "status-ok"}>
                {n0UnreadCount} não lida(s)
              </span>
            </div>
            <div className="support-inbox-tabs">
              <button
                type="button"
                className={inboxFilter === "all" ? "mode-btn mode-btn-active" : "mode-btn"}
                onClick={() => setInboxFilter("all")}
              >
                Tudo
              </button>
              <button
                type="button"
                className={inboxFilter === "chats" ? "mode-btn mode-btn-active" : "mode-btn"}
                onClick={() => setInboxFilter("chats")}
              >
                Chats
              </button>
              <button
                type="button"
                className={inboxFilter === "tickets" ? "mode-btn mode-btn-active" : "mode-btn"}
                onClick={() => setInboxFilter("tickets")}
              >
                Chamados
              </button>
            </div>
            <div className="support-inbox-search">
              <input
                placeholder="Buscar usuário, mensagem ou corrida"
                value={ticketSearch}
                onChange={(event) => setTicketSearch(event.target.value)}
              />
            </div>
            <div className="support-thread-list">
              {inboxItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    "support-thread-row",
                    selectedInboxId === item.id ? "support-thread-active" : "",
                    item.unread > 0 ? "support-thread-unread" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => selectInboxItem(item)}
                >
                  <span className="support-thread-avatar">{item.title.slice(0, 1).toUpperCase()}</span>
                  <span className="support-thread-main">
                    <span className="support-thread-title-row">
                      <strong>{item.title}</strong>
                      <small>{formatDateTime(item.timestamp)}</small>
                    </span>
                    <span className="support-thread-preview">{item.preview}</span>
                    <span className="support-thread-badges">
                      <span className={item.type === "n0" ? "status-ok" : priorityBadge(item.priority)}>
                        {item.type === "n0" ? "chat" : item.priority}
                      </span>
                      <span className={statusBadge(item.status)}>{item.status}</span>
                      <span className={item.tone}>{item.badge}</span>
                    </span>
                  </span>
                  {item.unread > 0 ? <span className="support-unread-pill">{item.unread}</span> : null}
                </button>
              ))}
              {inboxItems.length === 0 ? (
                <p className="text-muted">Nenhuma conversa ou chamado neste filtro.</p>
              ) : null}
            </div>
          </aside>

          <section className="support-conversation-panel card">
            {mode === "n0" ? (
              selectedN0Chat ? (
                <>
                  <div className="support-conversation-head">
                    <div className="support-conversation-avatar">{activeThreadTitle.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <h2>{activeThreadTitle}</h2>
                      <p>{activeThreadSubtitle}</p>
                    </div>
                    <div className="support-conversation-actions">
                      <button
                        type="button"
                        disabled={!!actionBusy || !canConvertSelectedN0}
                        title={
                          canConvertSelectedN0
                            ? ""
                            : selectedN0Chat?.ticketId
                              ? "Este chat já tem chamado vinculado."
                              : supportActionBlockReason(supportPolicy, "convert_n0", selectedN0Priority)
                        }
                        onClick={convertN0ChatToTicket}
                      >
                        Virar chamado
                      </button>
                      <button
                        type="button"
                        disabled={
                          !!actionBusy ||
                          selectedN0Chat.status === "closed" ||
                          !canRunSupportAction(supportPolicy, "close_chat", "N3")
                        }
                        onClick={closeN0Chat}
                      >
                        Encerrar
                      </button>
                    </div>
                  </div>
                  <div className="support-messages support-conversation-messages">
                    {filteredMessages.length === 0 ? (
                      <p className="text-muted">Sem histórico neste chat.</p>
                    ) : (
                      filteredMessages.map((message) => (
                        <div
                          key={message.id || `${message.createdAt}-${message.message}`}
                          className={`support-message-row support-message-${message.senderType || "user"}`}
                        >
                          <strong>{message.senderType === "agent" ? "Suporte" : "Usuário"}</strong>
                          <span>{message.message || "-"}</span>
                          <small>{formatDateTime(message.createdAt || message.timestamp)}</small>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="support-composer">
                    <div className="quick-reply-row">
                      {N0_QUICK_REPLIES.map((template) => (
                        <button key={template} type="button" onClick={() => updateActiveReply(template)}>
                          {template}
                        </button>
                      ))}
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Responder atendimento simples..."
                      value={replyValue}
                      onChange={(event) => updateActiveReply(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendActiveReply();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={sendActiveReply}
                      disabled={!!actionBusy || !replyValue.trim() || !canReplyActiveThread}
                    >
                      {actionBusy === "n0-message" ? "Enviando..." : "Enviar"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-muted">Selecione um chat.</p>
              )
            ) : selectedTicket ? (
              <>
                <div className="support-conversation-head">
                  <div className="support-conversation-avatar">{activeThreadTitle.slice(0, 1).toUpperCase()}</div>
                  <div>
                    <h2>{activeThreadTitle}</h2>
                    <p>{activeThreadSubtitle}</p>
                  </div>
                  <div className="support-conversation-actions">
                    <button
                      type="button"
                      className={mode === "ticket" ? "mode-btn mode-btn-active" : "mode-btn"}
                      onClick={() => setMode("ticket")}
                    >
                      Chamado
                    </button>
                    <button
                      type="button"
                      className={mode === "chat" ? "mode-btn mode-btn-active" : "mode-btn"}
                      onClick={() => setMode("chat")}
                    >
                      Chat
                    </button>
                    <button type="button" disabled={!!actionBusy || !canAssignSelected} onClick={assignToMe}>
                      Assumir
                    </button>
                    <button
                      type="button"
                      disabled={!!actionBusy || !canResolveSelected || !manualResolution.trim()}
                      onClick={resolveTicket}
                    >
                      Resolver
                    </button>
                  </div>
                </div>
                <div className="support-messages support-conversation-messages">
                  {filteredMessages.length === 0 ? (
                    <p className="text-muted">Sem mensagens neste canal.</p>
                  ) : (
                    filteredMessages.map((message) => (
                      <div
                        key={message.id || `${message.createdAt}-${message.message}`}
                        className={`support-message-row support-message-${message.senderType || "user"}`}
                      >
                        <strong>{message.senderType === "agent" ? "Suporte" : "Usuário"}</strong>
                        <span>{message.message || "-"}</span>
                        <small>{formatDateTime(message.createdAt || message.timestamp)}</small>
                      </div>
                    ))
                  )}
                </div>
                <div className="support-composer">
                  <div className="quick-reply-row">
                    {SUPPORT_QUICK_REPLIES.map((template) => (
                      <button key={template} type="button" onClick={() => updateActiveReply(template)}>
                        {template}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    placeholder={mode === "chat" ? "Responder chat..." : "Responder chamado..."}
                    value={replyValue}
                    onChange={(event) => updateActiveReply(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendActiveReply();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={sendActiveReply}
                    disabled={!!actionBusy || !replyValue.trim() || !canReplyActiveThread}
                  >
                    {actionBusy === "message" ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-muted">Selecione uma conversa ou chamado.</p>
            )}
          </section>

          <aside className="support-context-panel card">
            <div className="support-context-section">
              <h2>Contexto</h2>
              {activeContextUserId ? (
                <KeyValueGrid
                  data={supportUserDetails}
                  labels={{
                    nome: "Nome",
                    telefone: "Telefone",
                    email: "E-mail",
                    tipo: "Tipo",
                    status: "Status",
                    ticketsAbertos: "Tickets abertos",
                    ticketsNaFila: "Na fila",
                  }}
                  includeKeys={["nome", "telefone", "email", "tipo", "status", "ticketsAbertos", "ticketsNaFila"]}
                  maxItems={7}
                />
              ) : (
                <p className="text-muted">Selecione alguém na inbox.</p>
              )}
            </div>

            {mode === "n0" && selectedN0Chat ? (
              <div className="support-context-section">
                <h2>Chamado a partir do chat</h2>
                <div className="ticket-meta-row">
                  {selectedN0Chat.ticketId ? (
                    <span className="status-ok">já convertido</span>
                  ) : (
                    <span className={n0ConversionGaps.length ? "status-warn" : "status-ok"}>
                      {n0ConversionGaps.length ? "acompanhar" : "N0 suficiente"}
                    </span>
                  )}
                  <span className={priorityBadge(selectedN0Priority)}>{selectedN0Priority}</span>
                </div>
                {n0ConversionGaps.length ? (
                  <ul className="agent-rationale">
                    {n0ConversionGaps.slice(0, 3).map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                ) : null}
                <input
                  placeholder="Título do chamado"
                  value={n0TicketForm.subject}
                  onChange={(event) => setN0TicketForm((current) => ({ ...current, subject: event.target.value }))}
                />
                <select
                  value={n0TicketForm.priority}
                  onChange={(event) => setN0TicketForm((current) => ({ ...current, priority: event.target.value }))}
                >
                  <option value="N3">N3 - simples</option>
                  <option value="N2">N2 - acompanhamento</option>
                  <option value="N1">N1 - crítico</option>
                </select>
              </div>
            ) : null}

            {mode !== "n0" && selectedTicket ? (
              <div className="support-context-section">
                <h2>Ações</h2>
                <KeyValueGrid
                  data={selectedTicketDetails}
                  includeKeys={["id", "prioridade", "status", "categoria", "responsavel", "idade", "bookingId"]}
                  labels={{
                    id: "Ticket",
                    prioridade: "Prioridade",
                    status: "Status",
                    categoria: "Categoria",
                    responsavel: "Responsável",
                    idade: "Idade",
                    bookingId: "Corrida",
                  }}
                  maxItems={7}
                />
                <input
                  placeholder="Motivo para escalar"
                  value={manualEscalationReason}
                  onChange={(event) => setManualEscalationReason(event.target.value)}
                />
                <input
                  placeholder="Resumo para resolver"
                  value={manualResolution}
                  onChange={(event) => setManualResolution(event.target.value)}
                />
                <div className="support-context-actions">
                  <button
                    type="button"
                    disabled={!!actionBusy || !canEscalateSelected || !manualEscalationReason.trim()}
                    onClick={escalateTicket}
                  >
                    Escalar
                  </button>
                  {mode === "chat" ? (
                    <button
                      type="button"
                      disabled={
                        chatStatus?.status === "closed" ||
                        !canRunSupportAction(supportPolicy, "close_chat", selectedTicketTier)
                      }
                      onClick={closeChat}
                    >
                      Encerrar chat
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="support-context-section">
              <h2>Operação</h2>
              <div className="orchestrator-summary">
                <span className={supportOpsStatus.className}>{supportOpsStatus.label}</span>
                <span className="meta-badge">tempo real: {chatRealtime}</span>
                <span className="meta-badge">{supportPolicy.label}</span>
              </div>
              <p className="text-muted">{supportOpsStatus.detail}</p>
            </div>
          </aside>
        </section>

        <details className="support-advanced-drawer">
          <summary>Detalhes avançados, auditoria e copiloto</summary>

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
              <div className="row">
                <div className="label">Seu perfil</div>
                <div className="value">
                  {supportPolicy.label} · {supportPolicy.tiers.length ? supportPolicy.tiers.join(", ") : "somente leitura"}
                </div>
              </div>
            </div>
            <div className="orchestrator-summary">
              {SUPPORT_TIERS.map((tier) => (
                <span key={tier} className={supportPolicy.tiers.includes(tier) ? "status-ok" : "meta-badge"}>
                  {tier}
                </span>
              ))}
              {Object.entries(SUPPORT_ACTIONS).map(([action, label]) => (
                <span key={action} className={supportPolicy.actions.includes(action) ? "status-ok" : "meta-badge"}>
                  {label}
                </span>
              ))}
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

          <Panel
            title="Auditoria recente"
            subtitle="Últimas ações de suporte, aprovações humanas e leituras do copiloto."
            actions={
              <button type="button" onClick={loadSupportAudit}>
                Atualizar auditoria
              </button>
            }
          >
            {auditError ? <p className="text-muted">{auditError}</p> : null}
            {recentActionItems.length > 0 ? (
              <div className="run-list">
                {recentActionItems.map((item) => (
                  <div key={item.id} className="run-row">
                    <strong>{item.type}</strong>
                    <span>{item.label}</span>
                    <span className={item.className}>{item.status}</span>
                    <span className="table-muted">
                      {item.detail} · {formatDateTime(item.at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">Sem ações recentes disponíveis para este recorte.</p>
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
                  <button
                    type="button"
                    disabled={!!actionBusy || !canAssignSelected}
                    title={canAssignSelected ? "" : supportActionBlockReason(supportPolicy, "assign", selectedTicketTier)}
                    onClick={assignToMe}
                  >
                    Assumir
                  </button>
                  <button
                    type="button"
                    disabled={!!actionBusy || !canEscalateSelected || !manualEscalationReason.trim()}
                    title={canEscalateSelected ? "" : supportActionBlockReason(supportPolicy, "escalate", selectedTicketTier)}
                    onClick={escalateTicket}
                  >
                    Escalar
                  </button>
                  <button
                    type="button"
                    disabled={!!actionBusy || !canResolveSelected || !manualResolution.trim()}
                    title={canResolveSelected ? "" : supportActionBlockReason(supportPolicy, "resolve", selectedTicketTier)}
                    onClick={resolveTicket}
                  >
                    Resolver
                  </button>
                  {orchestratorEnabled ? (
                    <button type="button" disabled={orchestratorLoading} onClick={refreshOrchestratorAnalysis}>
                      Gerar sugestao
                    </button>
                  ) : null}
                  {mode === "chat" ? (
                    <button
                      type="button"
                      onClick={closeChat}
                      disabled={
                        chatStatus?.status === "closed" ||
                        !canRunSupportAction(supportPolicy, "close_chat", selectedTicketTier)
                      }
                    >
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

                <div className="agent-recommendation">
                  <div className="ticket-meta-row">
                    <strong>Ações manuais</strong>
                    <span className={priorityBadge(selectedTicketTier)}>tier atual: {selectedTicketTier}</span>
                    <span className={canMessageSelected ? "status-ok" : "status-warn"}>
                      {canMessageSelected ? "resposta liberada" : "resposta bloqueada"}
                    </span>
                  </div>
                  <div className="filters">
                    <input
                      placeholder="Motivo para escalar"
                      value={manualEscalationReason}
                      onChange={(event) => setManualEscalationReason(event.target.value)}
                    />
                    <input
                      placeholder="Resumo da resolução"
                      value={manualResolution}
                      onChange={(event) => setManualResolution(event.target.value)}
                    />
                  </div>
                  {!canResolveSelected || !canEscalateSelected ? (
                    <p className="text-muted">
                      RBAC ativo: {supportPolicy.label}. Ações fora do seu tier ficam bloqueadas antes de chamar a API.
                    </p>
                  ) : null}
                </div>

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
                        <label className="field-stack">
                          Nota interna aprovada
                          <textarea
                            rows={4}
                            value={copilotNoteDraft}
                            onChange={(event) => setCopilotNoteDraft(event.target.value)}
                            placeholder="Revise o texto antes de registrar no ticket."
                          />
                        </label>
                        <label className="field-stack">
                          Motivo da escalada aprovada
                          <textarea
                            rows={3}
                            value={copilotEscalationReason}
                            onChange={(event) => setCopilotEscalationReason(event.target.value)}
                            placeholder="Explique por que o ticket deve subir de tier."
                          />
                        </label>
                        <p className="text-muted">
                          Idempotency keys: nota <code>{copilotInternalNoteKey || "-"}</code> · escalada{" "}
                          <code>{copilotEscalationKey || "-"}</code>
                        </p>
                        <div className="filters">
                          <button
                            type="button"
                            disabled={
                              actionBusy === "copilot-note" ||
                              !orchestratorAnalysis?.id ||
                              !copilotNoteDraft.trim() ||
                              !canApplyCopilotNote
                            }
                            title={
                              canApplyCopilotNote
                                ? ""
                                : supportActionBlockReason(supportPolicy, "copilot_note", selectedTicketTier)
                            }
                            onClick={applyCopilotInternalNote}
                          >
                            {actionBusy === "copilot-note" ? "Aplicando..." : "Registrar nota interna"}
                          </button>
                          <button
                            type="button"
                            disabled={
                              actionBusy === "copilot-escalate" ||
                              !orchestratorAnalysis?.id ||
                              !copilotEscalationReason.trim() ||
                              !canApplyCopilotEscalation
                            }
                            title={
                              canApplyCopilotEscalation
                                ? ""
                                : supportActionBlockReason(supportPolicy, "copilot_escalate", selectedTicketTier)
                            }
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
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={!!actionBusy || !newMessage.trim() || !canMessageSelected}
                  >
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
                  <button
                    type="button"
                    disabled={!!actionBusy || !canConvertSelectedN0}
                    title={
                      canConvertSelectedN0
                        ? ""
                        : selectedN0Chat?.ticketId
                          ? "Este chat já tem chamado vinculado."
                          : supportActionBlockReason(supportPolicy, "convert_n0", selectedN0Priority)
                    }
                    onClick={convertN0ChatToTicket}
                  >
                    Transformar em chamado
                  </button>
                  <button
                    type="button"
                    disabled={
                      !!actionBusy ||
                      selectedN0Chat.status === "closed" ||
                      !canRunSupportAction(supportPolicy, "close_chat", "N3")
                    }
                    onClick={closeN0Chat}
                  >
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

                <div className="agent-recommendation">
                  <div className="ticket-meta-row">
                    <strong>Lacuna para virar chamado</strong>
                    {selectedN0Chat.ticketId ? (
                      <span className="status-ok">já convertido</span>
                    ) : (
                      <span className={n0ConversionGaps.length ? "status-warn" : "status-ok"}>
                        {n0ConversionGaps.length ? "requer ticket" : "N0 suficiente"}
                      </span>
                    )}
                    <span className={priorityBadge(selectedN0Priority)}>novo ticket {selectedN0Priority}</span>
                  </div>
                  {n0ConversionGaps.length ? (
                    <ul className="agent-rationale">
                      {n0ConversionGaps.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted">Sem lacuna operacional detectada para abrir ticket agora.</p>
                  )}
                  <div className="filters">
                    <input
                      placeholder="Título do chamado"
                      value={n0TicketForm.subject}
                      onChange={(event) =>
                        setN0TicketForm((current) => ({ ...current, subject: event.target.value }))
                      }
                    />
                    <select
                      value={n0TicketForm.priority}
                      onChange={(event) =>
                        setN0TicketForm((current) => ({ ...current, priority: event.target.value }))
                      }
                    >
                      <option value="N3">N3 - simples</option>
                      <option value="N2">N2 - precisa acompanhamento</option>
                      <option value="N1">N1 - crítico</option>
                    </select>
                    <input
                      placeholder="Categoria"
                      value={n0TicketForm.category}
                      onChange={(event) =>
                        setN0TicketForm((current) => ({ ...current, category: event.target.value }))
                      }
                    />
                  </div>
                  <textarea
                    rows={3}
                    value={n0TicketForm.description}
                    onChange={(event) =>
                      setN0TicketForm((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Resumo para o ticket"
                  />
                  <p className="text-muted">
                    Idempotency key: <code>{n0ConversionKey || "-"}</code>
                  </p>
                </div>

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
                  <button
                    type="button"
                    onClick={sendN0ChatMessage}
                    disabled={!!actionBusy || !n0ChatReply.trim() || !canRunSupportAction(supportPolicy, "message", "N3")}
                  >
                    {actionBusy === "n0-message" ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-muted">Selecione um chat N0.</p>
            )}
          </Panel>
        </section>
        </details>
        {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
