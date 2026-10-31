"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import useConfirmAction from "@/src/hooks/useConfirmAction";

const OPEN_STATUSES = new Set(["open", "assigned", "in_progress", "escalated"]);
const SUPPORT_POLL_MS = 60000;
const MESSAGE_POLL_MS = 30000;
const SUPPORT_FRESHNESS_TICK_MS = 10000;
const SUPPORT_TICKET_STALE_MS = SUPPORT_POLL_MS * 2.5;
const SUPPORT_MESSAGE_STALE_MS = MESSAGE_POLL_MS * 2.5;
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
const SUPPORT_WINDOW_NAME = "leaf-support";
const SUPPORT_WINDOW_FEATURES = "popup,width=1280,height=820";
const SUPPORT_CHANNELS = [
  { id: "app", label: "App" },
  { id: "whatsapp", label: "WhatsApp" },
];
const INBOX_FILTERS = {
  app: [
    { id: "all", label: "Todas" },
    { id: "mine", label: "Minhas" },
    { id: "unowned", label: "Sem dono" },
    { id: "overdue", label: "Atrasadas" },
  ],
  whatsapp: [
    { id: "all", label: "Todas" },
    { id: "reply_open", label: "Na janela" },
    { id: "reply_closed", label: "Fora da janela" },
  ],
};
const DEFAULT_SAVED_REPLIES = [
  { shortcut: "oi", message: N0_QUICK_REPLIES[0] },
  { shortcut: "detalhes", message: N0_QUICK_REPLIES[1] },
  { shortcut: "encerrar", message: N0_QUICK_REPLIES[2] },
  { shortcut: "verificando", message: SUPPORT_QUICK_REPLIES[0] },
  { shortcut: "chamado", message: SUPPORT_QUICK_REPLIES[1] },
  { shortcut: "atualizado", message: SUPPORT_QUICK_REPLIES[2] },
];
const SAVED_REPLY_MANAGER_ROLES = new Set(["admin", "manager", "super-admin", "development", "support_n3", "support-n3"]);
const SUPPORT_STATUS_LABELS = {
  active: "Ativo",
  open: "Aberto",
  assigned: "Atribuído",
  in_progress: "Em andamento",
  escalated: "Escalado",
  resolved: "Resolvido",
  closed: "Encerrado",
  approved: "Aprovado",
  blocked: "Bloqueado",
  suspended: "Suspenso",
};
const SUPPORT_PERSON_TYPES = {
  driver: "Motorista",
  motorista: "Motorista",
  customer: "Passageiro",
  passenger: "Passageiro",
  passageiro: "Passageiro",
};
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

function formatThreadTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  if (parsed.toDateString() === new Date().toDateString()) {
    return parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatMessageTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatMessageDay(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const today = new Date();
  if (parsed.toDateString() === today.toDateString()) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (parsed.toDateString() === yesterday.toDateString()) return "Ontem";
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function getMessageTime(message) {
  const parsed = new Date(message?.createdAt || message?.timestamp || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const brazilian = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (brazilian) return `+55 ${brazilian[1]} ${brazilian[2]}-${brazilian[3]}`;
  return digits ? `+${digits}` : "-";
}

function formatElapsed(value) {
  const ms = Math.max(0, Number(value || 0));
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return "agora";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function scopedFreshness(snapshot, scopeId) {
  if (!scopeId) return null;
  if (!snapshot?.scopeId || String(snapshot.scopeId) !== String(scopeId)) return null;
  return snapshot;
}

function describeSupportFreshness({ label, snapshot, now, staleAfterMs, transport }) {
  if (!snapshot?.lastSuccessAt && !snapshot?.lastErrorAt) {
    return {
      state: "waiting",
      className: "meta-badge",
      label: `${label}: aguardando`,
      detail: `${label} ainda sem leitura confirmada via ${transport}.`,
    };
  }

  if (snapshot?.error) {
    return {
      state: "error",
      className: "status-bad",
      label: `${label}: erro`,
      detail: `${label} falhou em ${formatDateTime(snapshot.lastErrorAt)}: ${snapshot.error}`,
    };
  }

  const ageMs = Math.max(0, Number(now || Date.now()) - Number(snapshot.lastSuccessAt || 0));
  const stale = ageMs > staleAfterMs;
  return {
    state: stale ? "stale" : "fresh",
    className: stale ? "status-warn" : "status-ok",
    label: `${label}: ${stale ? "defasado" : "atualizado"}`,
    detail: `${label} atualizado ${formatDateTime(snapshot.lastSuccessAt)} (${formatElapsed(ageMs)} atrás) via ${transport}.`,
  };
}

function summarizeSupportFreshness(items) {
  const activeItems = items.filter((item) => item && item.state !== "waiting");
  if (!activeItems.length) {
    return {
      state: "waiting",
      className: "meta-badge",
      label: "Dados: aguardando",
      detail: "Aguardando primeira leitura confirmada do suporte.",
    };
  }
  const failed = activeItems.find((item) => item.state === "error");
  if (failed) {
    return {
      state: "error",
      className: "status-bad",
      label: "Dados: erro",
      detail: failed.detail,
    };
  }
  const stale = activeItems.find((item) => item.state === "stale");
  if (stale) {
    return {
      state: "stale",
      className: "status-warn",
      label: "Dados: defasados",
      detail: stale.detail,
    };
  }
  return {
    state: "fresh",
    className: "status-ok",
    label: "Dados: atualizados",
    detail: activeItems.map((item) => item.detail).join(" "),
  };
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

function getTicketClassification(ticket) {
  return (
    ticket?.metadata?.supportClassification ||
    ticket?.supportClassification ||
    ticket?.classification ||
    null
  );
}

function formatClassificationReasons(classification) {
  const reasons = classification?.reasons || classification?.rationale || [];
  if (Array.isArray(reasons)) return reasons.filter(Boolean).join(", ");
  return String(reasons || "").trim();
}

function getTicketClassificationLabel(ticket) {
  const classification = getTicketClassification(ticket);
  if (!classification) return "";
  const priority = classification.priority || ticket?.priority || "N3";
  const severity = classification.severity || "normal";
  const source = classification.prioritySource || "classifier";
  return `${priority} · ${severity} · ${source}`;
}

function getChatChannel(chat) {
  return chat?.channel === "whatsapp" ? "whatsapp" : "app";
}

function getChatName(chat) {
  return chat?.userInfo?.name || chat?.userName || chat?.userId || "Usuario";
}

function getChatTitle(chat) {
  const name = getChatName(chat);
  return chat?.channel === "whatsapp" ? `WhatsApp · ${name}` : name;
}

function getWhatsAppWindow(chat, now) {
  if (chat?.status === "closed") return { open: false, label: "Encerrado" };
  const remainingMs = Date.parse(chat?.replyWindowExpiresAt || "") - now;
  if (!(remainingMs > 0)) return { open: false, label: "Janela encerrada" };
  return { open: true, label: `Janela: ${formatAge(remainingMs)}` };
}

function supportStatusLabel(status) {
  return SUPPORT_STATUS_LABELS[normalize(status)] || status || "-";
}

function deliveryLabel(status) {
  return ({ sending: "Enviando", unknown: "Sem confirmação — não reenviar", accepted: "Aceita pela Meta",
    sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falha no envio" })[status] || "";
}

function personTypeLabel(value) {
  return SUPPORT_PERSON_TYPES[normalize(value)] || "";
}

function formatMoney(value) {
  if (value === null || value === undefined) return "Sem valor fechado";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function SupportMessageBubbles({ messages, emptyText }) {
  if (!messages.length) return <p className="support-messages-empty">{emptyText}</p>;
  return messages.map((message, index) => {
    const sentAt = message.createdAt || message.timestamp;
    const day = formatMessageDay(sentAt);
    const showDay = index === 0 || day !== formatMessageDay(messages[index - 1].createdAt || messages[index - 1].timestamp);
    const fromAgent = message.senderType === "agent";
    const isNote = message.isInternal === true;
    const delivery = deliveryLabel(message.deliveryStatus);
    const ticks = { sent: "✓", delivered: "✓✓", read: "✓✓" }[message.deliveryStatus];
    return (
      <div key={message.id || `${sentAt}-${message.message}`} className="support-message-group">
        {showDay && day ? <span className="support-message-day">{day}</span> : null}
        <div className={`support-bubble ${isNote ? "support-bubble-note" : fromAgent ? "support-bubble-agent" : "support-bubble-user"}`}>
          {isNote ? (
            <span className="support-bubble-note-label">
              Nota interna{message.authorName ? ` · ${message.authorName}` : ""}, o cliente não vê
            </span>
          ) : null}
          <span className="support-bubble-text">{message.message || "-"}</span>
          <small>
            {formatMessageTime(sentAt)}
            {ticks ? (
              <span title={delivery} className={message.deliveryStatus === "read" ? "support-bubble-read" : ""}>{ticks}</span>
            ) : delivery ? (
              <span className={message.deliveryStatus === "failed" || message.deliveryStatus === "unknown" ? "support-bubble-failed" : ""}>
                {delivery}
              </span>
            ) : null}
          </small>
        </div>
      </div>
    );
  });
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
    getTicketClassificationLabel(ticket),
    formatClassificationReasons(getTicketClassification(ticket)),
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

function SupportPageContent({ supportScope }) {
  const chatRealtimeRef = useRef(false);
  const threadMessagesRef = useRef(null);
  const composerInputRef = useRef(null);
  const supportWindowRef = useRef(null);
  const isDetachedWindow = useSearchParams().get("view") === "window";
  const whatsappSendKeys = useRef(new Map());
  const { user } = useAuth();
  const { requestConfirmation, confirmationDialog } = useConfirmAction();
  const isOperationalSupportScope = supportScope === "operational";
  const isSandboxSupportScope = supportScope === "sandbox";
  const supportApiContext = useMemo(() => ({ scope: supportScope }), [supportScope]);
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
  const [inboxChannel, setInboxChannel] = useState("app");
  const [contextOpen, setContextOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [composerMode, setComposerMode] = useState("reply");
  const [noteDraft, setNoteDraft] = useState("");
  const [chatNotes, setChatNotes] = useState([]);
  const [savedReplies, setSavedReplies] = useState([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [savedReplyForm, setSavedReplyForm] = useState({ shortcut: "", message: "" });
  const [activeRide, setActiveRide] = useState(null);
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
  const [freshnessClock, setFreshnessClock] = useState(() => Date.now());
  const [supportFreshness, setSupportFreshness] = useState({
    tickets: {},
    inbox: {},
    ticketMessages: {},
    rideChatMessages: {},
    n0ChatMessages: {},
  });

  const selectedUserId = selectedTicket?.userId || selectedTicket?.user?.id || null;
  const activeContextUserId = mode === "n0"
    ? (selectedN0Chat?.channel === "whatsapp" ? null : selectedN0Chat?.userId || null)
    : selectedUserId;
  const orchestratorEnabled = isOperationalSupportScope && leafAPI.isSupportOrchestratorEnabled();

  const markFreshnessSuccess = useCallback((key, scopeId = null) => {
    const timestamp = Date.now();
    setSupportFreshness((current) => ({
      ...current,
      [key]: {
        scopeId,
        lastSuccessAt: timestamp,
        lastErrorAt: null,
        error: "",
      },
    }));
  }, []);

  const markFreshnessError = useCallback((key, error, scopeId = null) => {
    const timestamp = Date.now();
    setSupportFreshness((current) => ({
      ...current,
      [key]: {
        ...current[key],
        scopeId,
        lastErrorAt: timestamp,
        error: error?.message || String(error || "Falha ao atualizar dados"),
      },
    }));
  }, []);

  const loadTickets = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        let nextTickets = [];
        let nextSummary = null;

        try {
          const [summaryResponse, backlogResponse] = await Promise.all([
            leafAPI.getSupportQueueSummary(supportApiContext),
            leafAPI.getSupportQueueBacklog({
              status: statusFilter === "all" ? undefined : statusFilter,
              priority: priorityFilter === "all" ? undefined : priorityFilter,
              limit: 200,
              offset: 0,
            }, supportApiContext),
          ]);
          nextSummary = summaryResponse?.summary || null;
          nextTickets = backlogResponse?.tickets || [];
        } catch {
          const fallback = await leafAPI.getSupportTickets({
            status: statusFilter === "all" ? undefined : statusFilter,
            priority: priorityFilter === "all" ? undefined : priorityFilter,
            page: 1,
            limit: 200,
          }, supportApiContext);
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
        markFreshnessSuccess("tickets");
      } catch (err) {
        markFreshnessError("tickets", err);
        setError(err?.message || "Falha ao carregar fila de suporte");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [markFreshnessError, markFreshnessSuccess, priorityFilter, statusFilter, supportApiContext],
  );

  const loadChatInbox = useCallback(async () => {
    if (!isOperationalSupportScope) {
      setChatInbox([]);
      setSelectedN0Chat(null);
      return;
    }
    try {
      const response = await leafAPI.getSupportChatInbox({
        limit: 80,
        includeClosed: showClosedN0Chats,
        ...supportApiContext,
      });
      const nextChats = response?.chats || [];
      setChatInbox(nextChats);
      setSelectedN0Chat((current) => {
        if (!current) return nextChats.find((chat) => getChatChannel(chat) === "app") || null;
        return nextChats.find((chat) => chat.userId === current.userId)
          || nextChats.find((chat) => getChatChannel(chat) === getChatChannel(current))
          || null;
      });
      markFreshnessSuccess("inbox");
    } catch (err) {
      markFreshnessError("inbox", err);
      setError(err?.message || "Falha ao carregar chats N0");
    }
  }, [isOperationalSupportScope, markFreshnessError, markFreshnessSuccess, showClosedN0Chats, supportApiContext]);

  const loadTicketMessages = useCallback(async (ticketId) => {
    const normalizedTicketId = String(ticketId || "").trim();
    if (!normalizedTicketId) {
      setTicketMessages([]);
      return;
    }
    try {
      const response = await leafAPI.getSupportMessages(normalizedTicketId, supportApiContext);
      setTicketMessages(response?.messages || []);
      markFreshnessSuccess("ticketMessages", normalizedTicketId);
    } catch (err) {
      markFreshnessError("ticketMessages", err, normalizedTicketId);
      setError(err?.message || "Falha ao carregar mensagens do ticket");
    }
  }, [markFreshnessError, markFreshnessSuccess, supportApiContext]);

  useEffect(() => {
    const timer = setInterval(() => setFreshnessClock(Date.now()), SUPPORT_FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

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
    if (!isOperationalSupportScope) {
      setAuditLogs([]);
      setAuditError("");
      return;
    }
    try {
      const response = await leafAPI.listAuditLogs({ resource: "support", limit: 12 });
      setAuditLogs(response?.logs || []);
      setAuditError("");
    } catch (err) {
      setAuditLogs([]);
      setAuditError(err?.message || "Auditoria indisponível para este perfil.");
    }
  }, [isOperationalSupportScope]);

  useEffect(() => {
    if (isOperationalSupportScope) return;
    chatRealtimeRef.current = false;
    setChatRealtime("somente polling isolado");
    setChatInbox([]);
    setSelectedN0Chat(null);
    setChatMessages([]);
    setN0ChatMessages([]);
    setChatStatus(null);
    setTypeFilter("tickets");
    setMode("ticket");
  }, [isOperationalSupportScope]);

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
    if (!isOperationalSupportScope) return undefined;
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
  }, [isOperationalSupportScope, loadChatInbox]);

  useEffect(() => {
    if (!isOperationalSupportScope) return undefined;
    let mounted = true;
    const onNewChatMessage = (message) => {
      if (!message?.userId) return;
      loadChatInbox();
      setN0ChatMessages((current) => {
        if (selectedN0Chat?.userId !== message.userId) return current;
        if (current.some((item) => item.id === message.id)) {
          return message.channel === "whatsapp"
            ? current.map((item) => item.id === message.id ? { ...item, ...message } : item)
            : current;
        }
        return [...current, message].slice(-80);
      });
    };
    const onChatStatusChange = () => {
      loadChatInbox();
    };
    const onNewSupportTicket = () => {
      if (!mounted) return;
      loadTickets({ silent: true });
    };
    const onNewSupportMessage = (event) => {
      if (!mounted) return;
      loadTickets({ silent: true });
      const eventTicketId = String(event?.ticketId || event?.message?.ticketId || "").trim();
      if (eventTicketId && eventTicketId === String(selectedTicket?.id || "").trim()) {
        loadTicketMessages(eventTicketId);
      }
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
    wsService.on("support:ticket:new", onNewSupportTicket);
    wsService.on("support:message:new", onNewSupportMessage);
    wsService.on("authenticated", onRealtimeReady);
    wsService.on("disconnect", onRealtimeUnavailable);
    wsService
      .connect({ namespace: "/dashboard" })
      .then(onRealtimeReady)
      .catch(onRealtimeUnavailable);

    return () => {
      mounted = false;
      chatRealtimeRef.current = false;
      wsService.off("support:chat:new", onNewChatMessage);
      wsService.off("support:chat:closed", onChatStatusChange);
      wsService.off("support:chat:converted", onChatStatusChange);
      wsService.off("support:ticket:new", onNewSupportTicket);
      wsService.off("support:message:new", onNewSupportMessage);
      wsService.off("authenticated", onRealtimeReady);
      wsService.off("disconnect", onRealtimeUnavailable);
    };
  }, [isOperationalSupportScope, loadChatInbox, loadTicketMessages, loadTickets, selectedN0Chat?.userId, selectedTicket?.id]);

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
    const refreshSelectedTicketMessages = async () => {
      if (!mounted) return;
      await loadTicketMessages(selectedTicket.id);
    };
    refreshSelectedTicketMessages();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshSelectedTicketMessages();
      }
    }, MESSAGE_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadTicketMessages, selectedTicket]);

  useEffect(() => {
    if (!isOperationalSupportScope || !selectedUserId) {
      setChatMessages([]);
      setChatStatus(null);
      return;
    }
    let mounted = true;
    const loadChatData = async () => {
      try {
        const [history, status] = await Promise.all([
          leafAPI.getChatHistory(selectedUserId, 80, supportApiContext),
          leafAPI.getChatStatus(selectedUserId, supportApiContext).catch(() => ({ status: { status: "unknown" } })),
        ]);
        if (!mounted) return;
        setChatMessages(history?.messages || []);
        setChatStatus(status?.status || null);
        markFreshnessSuccess("rideChatMessages", selectedUserId);
      } catch (err) {
        if (mounted) {
          markFreshnessError("rideChatMessages", err, selectedUserId);
          setError(err?.message || "Falha ao carregar chat");
        }
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
  }, [isOperationalSupportScope, markFreshnessError, markFreshnessSuccess, selectedUserId, supportApiContext]);

  useEffect(() => {
    if (!isOperationalSupportScope || !selectedN0Chat?.userId) {
      setN0ChatMessages([]);
      return;
    }
    let mounted = true;
    const loadN0Chat = async () => {
      try {
        const includeArchived = showClosedN0Chats || selectedN0Chat.status === "closed";
        const history = await leafAPI.getChatHistory(selectedN0Chat.userId, 80, {
          includeArchived,
          ...supportApiContext,
        });
        if (!mounted) return;
        const messages = history?.messages || [];
        setN0ChatMessages(messages);
        markFreshnessSuccess("n0ChatMessages", selectedN0Chat.userId);
        if (messages.some((message) => message.senderType === "user" && message.read !== true)) {
          await leafAPI.markChatRead(selectedN0Chat.userId, [], supportApiContext).catch(() => null);
        }
      } catch (err) {
        if (mounted) {
          markFreshnessError("n0ChatMessages", err, selectedN0Chat.userId);
          setError(err?.message || "Falha ao carregar chat N0");
        }
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
  }, [
    isOperationalSupportScope,
    markFreshnessError,
    markFreshnessSuccess,
    selectedN0Chat?.status,
    selectedN0Chat?.userId,
    showClosedN0Chats,
    supportApiContext,
  ]);

  useEffect(() => {
    if (!isOperationalSupportScope || !activeContextUserId) {
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
  }, [activeContextUserId, isOperationalSupportScope]);

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
      if (mode === "n0") return [...n0ChatMessages, ...chatNotes];
      return mode === "ticket" ? ticketMessages : [...chatMessages, ...chatNotes];
    },
    [chatMessages, chatNotes, mode, n0ChatMessages, ticketMessages],
  );
  const activeMessagesFreshnessSnapshot = useMemo(() => {
    if (mode === "n0") return scopedFreshness(supportFreshness.n0ChatMessages, selectedN0Chat?.userId);
    if (mode === "chat") return scopedFreshness(supportFreshness.rideChatMessages, selectedUserId);
    return scopedFreshness(supportFreshness.ticketMessages, selectedTicket?.id);
  }, [
    mode,
    selectedN0Chat?.userId,
    selectedTicket?.id,
    selectedUserId,
    supportFreshness.n0ChatMessages,
    supportFreshness.rideChatMessages,
    supportFreshness.ticketMessages,
  ]);
  const activeMessagesFreshnessLabel = mode === "n0"
    ? "Chat N0"
    : mode === "chat"
      ? "Chat corrida"
      : "Mensagens";
  const ticketsFreshness = useMemo(
    () => describeSupportFreshness({
      label: "Tickets",
      now: freshnessClock,
      snapshot: supportFreshness.tickets,
      staleAfterMs: SUPPORT_TICKET_STALE_MS,
      transport: "polling",
    }),
    [freshnessClock, supportFreshness.tickets],
  );
  const inboxFreshness = useMemo(
    () => describeSupportFreshness({
      label: "Inbox N0",
      now: freshnessClock,
      snapshot: supportFreshness.inbox,
      staleAfterMs: SUPPORT_MESSAGE_STALE_MS,
      transport: chatRealtime === "tempo real" ? "Socket.IO + fallback polling" : "polling",
    }),
    [chatRealtime, freshnessClock, supportFreshness.inbox],
  );
  const activeMessagesFreshness = useMemo(
    () => describeSupportFreshness({
      label: activeMessagesFreshnessLabel,
      now: freshnessClock,
      snapshot: activeMessagesFreshnessSnapshot,
      staleAfterMs: SUPPORT_MESSAGE_STALE_MS,
      transport: mode === "n0" && chatRealtime === "tempo real" ? "Socket.IO + fallback polling" : "polling",
    }),
    [activeMessagesFreshnessLabel, activeMessagesFreshnessSnapshot, chatRealtime, freshnessClock, mode],
  );
  const supportFreshnessStatus = useMemo(
    () => summarizeSupportFreshness([ticketsFreshness, inboxFreshness, activeMessagesFreshness]),
    [activeMessagesFreshness, inboxFreshness, ticketsFreshness],
  );
  const filteredTickets = useMemo(() => {
    const term = ticketSearch.trim().toLowerCase();
    return tickets.filter((ticket) => ticketMatchesSearch(ticket, term));
  }, [tickets, ticketSearch]);
  const filteredMessages = useMemo(() => {
    const term = messageSearch.trim().toLowerCase();
    const chronological = [...currentMessages].sort((left, right) => getMessageTime(left) - getMessageTime(right));
    if (!term) return chronological;
    return chronological.filter((message) =>
      `${message?.senderType || ""} ${message?.senderId || ""} ${message?.message || ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [currentMessages, messageSearch]);
  const activeThreadKey = mode === "n0" ? `n0:${selectedN0Chat?.userId}` : `${mode}:${selectedTicket?.id}`;
  useEffect(() => {
    const container = threadMessagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [activeThreadKey, filteredMessages.length]);
  const noteUserId = mode === "n0" ? selectedN0Chat?.userId : mode === "chat" ? selectedUserId : null;
  useEffect(() => {
    if (!isOperationalSupportScope || !noteUserId) {
      setChatNotes([]);
      return undefined;
    }
    let mounted = true;
    const loadNotes = () => leafAPI.getSupportChatNotes(noteUserId, supportApiContext)
      .then((response) => {
        if (mounted) setChatNotes(response?.notes || []);
      })
      .catch(() => null);
    setChatNotes([]);
    loadNotes();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadNotes();
    }, MESSAGE_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [isOperationalSupportScope, noteUserId, supportApiContext]);
  useEffect(() => {
    let mounted = true;
    leafAPI.getSupportSavedReplies(supportApiContext)
      .then((response) => {
        if (mounted) setSavedReplies(response?.replies || []);
      })
      .catch(() => null);
    return () => {
      mounted = false;
    };
  }, [supportApiContext]);
  const activeRideTicket = mode === "n0"
    ? tickets.find((ticket) => ticket.id === selectedN0Chat?.ticketId)
    : selectedTicket;
  const activeRideId = activeRideTicket?.metadata?.bookingId
    || activeRideTicket?.metadata?.tripId
    || activeRideTicket?.metadata?.rideId
    || activeRideTicket?.bookingId
    || null;
  useEffect(() => {
    setActiveRide(null);
    if (!isOperationalSupportScope || !activeRideId) return undefined;
    let mounted = true;
    leafAPI.getSupportRide(activeRideId, supportApiContext)
      .then((response) => {
        if (mounted) setActiveRide(response?.ride || null);
      })
      .catch(() => null);
    return () => {
      mounted = false;
    };
  }, [activeRideId, isOperationalSupportScope, supportApiContext]);
  const matchesQueue = useCallback((item, queue) => {
    if (queue === "reply_open") return Boolean(item.canReply);
    if (queue === "reply_closed") return !item.canReply;
    if (queue === "overdue") return item.overdue === true;
    if (queue === "mine") {
      return item.type === "ticket" && [user?.id, user?.uid, user?.email].filter(Boolean).includes(item.ownerId);
    }
    if (queue === "unowned") {
      return item.type === "ticket"
        ? !item.ownerId
        : !item.raw?.ticketId && normalize(item.status) !== "closed";
    }
    return true;
  }, [user?.email, user?.id, user?.uid]);
  const allInboxItems = useMemo(() => {
    const ticketItems = tickets.map((ticket) => {
      const health = queueHealthBadge(ticket);
      const classificationLabel = getTicketClassificationLabel(ticket);
      return {
        id: `ticket:${ticket.id}`,
        type: "ticket",
        channel: "app",
        ownerId: ticket.assignedAgent || "",
        overdue: Boolean(ticket.queue?.overdueAck || ticket.queue?.overdueFirstResponse),
        title: getTicketTitle(ticket),
        subtitle: [personTypeLabel(ticket.userType), ticket.user?.name || ticket.userId || "Usuário sem identificação"]
          .filter(Boolean)
          .join(" · "),
        preview: getTicketDescription(ticket) || ticket.category || "Chamado sem mensagem recente.",
        timestamp: ticket.updatedAt || ticket.createdAt,
        unread: ticket.queue?.overdueFirstResponse || ticket.queue?.overdueAck ? 1 : 0,
        priority: ticket.priority || "N3",
        status: ticket.status || "open",
        tone: health.className,
        badge: classificationLabel || health.label,
        raw: ticket,
      };
    });
    const chatItems = chatInbox.map((chat) => {
      const isWhatsApp = chat.channel === "whatsapp";
      const replyWindow = isWhatsApp ? getWhatsAppWindow(chat, freshnessClock) : null;
      return {
        id: `chat:${chat.userId}`,
        type: "n0",
        channel: getChatChannel(chat),
        title: getChatName(chat),
        subtitle: isWhatsApp ? formatPhone(chat.phone) : personTypeLabel(getUserType(chat.userInfo)),
        phone: chat.phone,
        preview: chat.lastMessage?.message || "Sem mensagem recente.",
        timestamp: chat.lastMessageAt || chat.updatedAt,
        unread: Number(chat.unreadFromUser || 0),
        priority: chat.ticketId ? "N2" : "N3",
        status: chat.status || "active",
        tone: isWhatsApp
          ? (replyWindow.open ? "status-ok" : "status-warn")
          : (chat.unreadFromUser > 0 ? "status-warn" : "status-ok"),
        badge: isWhatsApp ? replyWindow.label : chat.ticketId ? "com chamado" : "chat",
        canReply: replyWindow?.open,
        raw: chat,
      };
    });
    return [...chatItems, ...ticketItems].sort((left, right) => {
      const unreadDelta = Number(right.unread > 0) - Number(left.unread > 0);
      if (unreadDelta !== 0) return unreadDelta;
      return new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime();
    });
  }, [chatInbox, freshnessClock, tickets]);
  const inboxItems = useMemo(() => {
    const searchTerm = ticketSearch.trim().toLowerCase();
    return allInboxItems.filter((item) => {
      if (item.channel !== inboxChannel) return false;
      if (item.channel === "app") {
        if (typeFilter === "chats" && item.type !== "n0") return false;
        if (typeFilter === "tickets" && item.type !== "ticket") return false;
      }
      if (inboxFilter !== "all" && !matchesQueue(item, inboxFilter)) return false;
      if (!searchTerm) return true;
      return [item.title, item.subtitle, item.phone, item.preview, item.status, item.priority]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });
  }, [allInboxItems, inboxChannel, inboxFilter, matchesQueue, ticketSearch, typeFilter]);
  const queueCounts = useMemo(() => {
    const appItems = allInboxItems.filter((item) => item.channel === "app");
    return Object.fromEntries(
      ["mine", "unowned", "overdue"].map((queue) => [queue, appItems.filter((item) => matchesQueue(item, queue)).length]),
    );
  }, [allInboxItems, matchesQueue]);
  const channelSummary = useMemo(() => {
    const summaryByChannel = { app: { total: 0, unread: 0 }, whatsapp: { total: 0, unread: 0 } };
    allInboxItems.forEach((item) => {
      summaryByChannel[item.channel].total += 1;
      if (item.type === "n0") summaryByChannel[item.channel].unread += item.unread;
    });
    return summaryByChannel;
  }, [allInboxItems]);
  const selectedInboxId = mode === "n0"
    ? (selectedN0Chat?.userId ? `chat:${selectedN0Chat.userId}` : "")
    : (selectedTicket?.id ? `ticket:${selectedTicket.id}` : "");
  const copilotPriority = useMemo(() => getCopilotPriority(orchestratorAnalysis), [orchestratorAnalysis]);
  const copilotRationale = useMemo(() => getCopilotRationale(orchestratorAnalysis), [orchestratorAnalysis]);
  const copilotSuggestion = useMemo(() => getCopilotSuggestion(orchestratorAnalysis), [orchestratorAnalysis]);

  const selectedTicketDetails = useMemo(() => {
    if (!selectedTicket) return {};
    const classification = getTicketClassification(selectedTicket);
    return {
      id: selectedTicket.id,
      prioridade: selectedTicket.priority || "N3",
      status: supportStatusLabel(selectedTicket.status || "open"),
      categoria: selectedTicket.category || "-",
      classificacao: getTicketClassificationLabel(selectedTicket) || "-",
      origemSeveridade: classification?.prioritySource || "-",
      racionalSeveridade: formatClassificationReasons(classification) || "-",
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
        detail: `${summary.ticketsWithoutOwner} ticket(s) sem dono e ${n0UnreadCount} chat(s) N0 não lido(s).`,
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
    () => (selectedN0Chat ? getChatName(selectedN0Chat) : ""),
    [selectedN0Chat],
  );
  const selectedWhatsAppWindow = selectedN0Chat?.channel === "whatsapp"
    ? getWhatsAppWindow(selectedN0Chat, freshnessClock)
    : null;
  const canAssignSelected = canRunSupportAction(supportPolicy, "assign", selectedTicketTier);
  const canMessageSelected = canRunSupportAction(supportPolicy, "message", selectedTicketTier);
  const canResolveSelected = canRunSupportAction(supportPolicy, "resolve", selectedTicketTier);
  const canEscalateSelected = canRunSupportAction(supportPolicy, "escalate", selectedTicketTier);
  const canApplyCopilotNote = canRunSupportAction(supportPolicy, "copilot_note", selectedTicketTier);
  const canApplyCopilotEscalation = canRunSupportAction(supportPolicy, "copilot_escalate", selectedTicketTier);
  const canConvertSelectedN0 =
    selectedN0Chat?.userId &&
    selectedN0Chat?.channel !== "whatsapp" &&
    !selectedN0Chat?.ticketId &&
    n0ConversionGaps.length > 0 &&
    canRunSupportAction(supportPolicy, "convert_n0", selectedN0Priority);
  const activeThreadTitle = mode === "n0"
    ? selectedN0ChatTitle
    : mode === "chat"
      ? `${selectedTicket?.user?.name || selectedTicket?.userId || "Usuário"}`
      : getTicketTitle(selectedTicket);
  const activeThreadSubtitle = mode === "n0"
    ? selectedWhatsAppWindow
      ? `WhatsApp · ${formatPhone(selectedN0Chat?.phone)} · ${selectedWhatsAppWindow.label}`
      : `App · ${supportStatusLabel(selectedN0Chat?.status || "active")} · ${selectedN0Chat?.unreadFromUser || 0} não lida(s)`
    : `${selectedTicket?.user?.name || selectedTicket?.userId || "sem usuário"} · ${selectedTicket?.priority || "N3"} · ${supportStatusLabel(selectedTicket?.status || "open")}`;
  const threadContextChips = (() => {
    if (mode === "n0" && selectedWhatsAppWindow) {
      return [
        { label: "Conta Leaf não verificada", className: "status-warn" },
        { label: selectedWhatsAppWindow.label, className: selectedWhatsAppWindow.open ? "status-ok" : "status-warn" },
      ];
    }
    const personType = personTypeLabel(
      supportUserContext ? getUserType(supportUserContext)
        : mode === "n0" ? getUserType(selectedN0Chat?.userInfo) : selectedTicket?.userType,
    );
    const chips = [];
    if (personType) chips.push({ label: personType, className: "meta-badge" });
    if (supportUserDetails.status !== "-") {
      chips.push({ label: supportStatusLabel(supportUserDetails.status), className: "meta-badge" });
    }
    if (supportUserDetails.telefone !== "-") chips.push({ label: supportUserDetails.telefone, className: "meta-badge" });
    if (mode === "n0") {
      if (selectedN0Chat?.ticketId) chips.push({ label: "Com chamado", className: "status-ok" });
      if (supportUserDetails.ticketsAbertos > 0) {
        chips.push({ label: `${supportUserDetails.ticketsAbertos} chamado(s) aberto(s)`, className: "meta-badge" });
      }
      return chips;
    }
    if (!selectedTicket) return chips;
    const health = queueHealthBadge(selectedTicket);
    chips.push({ label: health.label, className: health.className });
    chips.push({ label: `Dono: ${selectedTicketDetails.responsavel}`, className: "meta-badge" });
    if (selectedTicketDetails.idade !== "-") chips.push({ label: `Há ${selectedTicketDetails.idade}`, className: "meta-badge" });
    if (selectedTicketDetails.bookingId !== "-" && !activeRide) {
      chips.push({ label: `Corrida ${selectedTicketDetails.bookingId}`, className: "meta-badge" });
    }
    const classificationLabel = getTicketClassificationLabel(selectedTicket);
    if (classificationLabel) {
      chips.push({ label: classificationLabel, className: priorityBadge(selectedTicket.priority) });
      const reasons = formatClassificationReasons(getTicketClassification(selectedTicket));
      if (reasons) chips.push({ label: reasons, className: "meta-badge", title: reasons });
    }
    return chips;
  })();
  const threadContextBar = threadContextChips.length ? (
    <div className="support-thread-context">
      {threadContextChips.map((chip) => (
        <span key={chip.label} className={chip.className} title={chip.title || chip.label}>{chip.label}</span>
      ))}
    </div>
  ) : null;
  const openSupportWindow = () => {
    if (supportWindowRef.current && !supportWindowRef.current.closed) {
      supportWindowRef.current.focus();
      return;
    }
    const params = new URLSearchParams({ view: "window" });
    if (!isOperationalSupportScope) params.set("scope", supportScope);
    // Sem noopener: é assim que a janela herda a sessão guardada no sessionStorage.
    const opened = window.open(`/support?${params}`, SUPPORT_WINDOW_NAME, SUPPORT_WINDOW_FEATURES);
    if (!opened) {
      setError("O navegador bloqueou a janela. Libere pop-ups do dashboard e tente de novo.");
      return;
    }
    supportWindowRef.current = opened;
    opened.focus();
  };
  const contextToggle = (
    <button
      type="button"
      className={contextOpen ? "mode-btn mode-btn-active" : "mode-btn"}
      aria-expanded={contextOpen}
      onClick={() => setContextOpen((current) => !current)}
    >
      Dados
    </button>
  );
  const replyValue = mode === "n0" ? n0ChatReply : newMessage;
  const whatsappReplyBlocked = selectedN0Chat?.channel === "whatsapp" && (
    selectedN0Chat.status === "closed" || selectedN0Chat.pendingOperationId ||
    !selectedN0Chat.replyWindowExpiresAt || freshnessClock >= Date.parse(selectedN0Chat.replyWindowExpiresAt)
  );
  const canReplyActiveThread = mode === "n0"
    ? canRunSupportAction(supportPolicy, "message", "N3") && !whatsappReplyBlocked
    : canMessageSelected;
  const selectInboxItem = (item) => {
    setError("");
    setActionMessage("");
    setNoteDraft("");
    if (item.type === "n0") {
      setSelectedN0Chat(item.raw);
      setMode("n0");
      return;
    }
    setSelectedTicket(item.raw);
    setMode("ticket");
  };
  const selectInboxChannel = (channel) => {
    if (channel === inboxChannel) return;
    setInboxChannel(channel);
    setInboxFilter("all");
    const firstItem = allInboxItems.find((item) => item.channel === channel);
    if (firstItem) {
      selectInboxItem(firstItem);
      return;
    }
    setError("");
    setActionMessage("");
    if (channel === "whatsapp") setSelectedN0Chat(null);
    setMode(channel === "whatsapp" ? "n0" : "ticket");
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
        await leafAPI.sendChatMessage(selectedUserId, text, supportApiContext);
        const history = await leafAPI.getChatHistory(selectedUserId, 80, supportApiContext);
        setChatMessages(history?.messages || []);
        markFreshnessSuccess("rideChatMessages", selectedUserId);
      } else {
        await leafAPI.sendSupportMessage(selectedTicket.id, text, "text", [], supportApiContext);
        const response = await leafAPI.getSupportMessages(selectedTicket.id, supportApiContext);
        setTicketMessages(response?.messages || []);
        markFreshnessSuccess("ticketMessages", selectedTicket.id);
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
      await leafAPI.assignSupportTicket(selectedTicket.id, agentId, agentName, supportApiContext);
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
      await leafAPI.escalateSupportTicket(selectedTicket.id, reason, supportApiContext);
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
      await leafAPI.resolveSupportTicket(selectedTicket.id, resolution, supportApiContext);
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
    if (!selectedN0Chat?.userId || !n0ChatReply.trim() || actionBusy || whatsappReplyBlocked) return;
    if (!canRunSupportAction(supportPolicy, "message", "N3")) {
      setError(supportActionBlockReason(supportPolicy, "message", "N3"));
      return;
    }
    const text = n0ChatReply.trim();
    const key = `${selectedN0Chat.userId}\n${text}`;
    const isWhatsApp = selectedN0Chat.channel === "whatsapp";
    if (isWhatsApp && !whatsappSendKeys.current.has(key)) {
      whatsappSendKeys.current.set(key, crypto.randomUUID());
    }
    setN0ChatReply("");
    try {
      setActionBusy("n0-message");
      setError("");
      setActionMessage("");
      await leafAPI.sendChatMessage(selectedN0Chat.userId, text, {
        ...supportApiContext, whatsappRequestId: isWhatsApp ? whatsappSendKeys.current.get(key) : undefined,
      });
      whatsappSendKeys.current.delete(key);
      setActionMessage(isWhatsApp ? "Mensagem aceita pela Meta. Acompanhe o status de entrega." : "Mensagem enviada no chat N0.");
      try {
        const history = await leafAPI.getChatHistory(selectedN0Chat.userId, 80, supportApiContext);
        setN0ChatMessages(history?.messages || []);
        await loadChatInbox();
      } catch {
        setError("Envio confirmado, mas a atualização da conversa falhou. Atualize antes de reenviar.");
      }
    } catch (err) {
      if (err?.payload?.code === "WHATSAPP_REJECTED") whatsappSendKeys.current.delete(key);
      setError(err?.message || "Falha ao responder chat N0");
      setN0ChatReply(text);
      if (isWhatsApp) await loadChatInbox().catch(() => null);
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
      }, { idempotencyKey: n0ConversionKey, ...supportApiContext });
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

  const requestCloseChat = () => requestConfirmation({
    title: "Encerrar chat deste usuário?",
    description: "O chat será encerrado e ficará disponível apenas para consulta histórica.",
    confirmLabel: "Encerrar chat",
    tone: "warning",
    task: closeChat,
  });

  const requestCloseN0Chat = () => requestConfirmation({
    title: "Encerrar atendimento simples?",
    description: "O atendimento N0 será encerrado e o histórico será arquivado.",
    confirmLabel: "Encerrar atendimento",
    tone: "warning",
    task: closeN0Chat,
  });

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
        leafAPI
          .getSupportMessages(selectedTicket.id, supportApiContext)
          .then((data) => {
            setTicketMessages(data?.messages || []);
            markFreshnessSuccess("ticketMessages", selectedTicket.id);
          })
          .catch((err) => markFreshnessError("ticketMessages", err, selectedTicket.id)),
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

  const availableReplies = savedReplies.length ? savedReplies : DEFAULT_SAVED_REPLIES;
  const canManageSavedReplies = SAVED_REPLY_MANAGER_ROLES.has(supportPolicy.role);
  const isNoteMode = composerMode === "note";
  const composerDraft = isNoteMode ? noteDraft : replyValue;
  const canWriteNote = mode === "n0" ? canRunSupportAction(supportPolicy, "message", "N3") : canMessageSelected;
  const slashTerm = /^\/[\w-]*$/.test(composerDraft) ? composerDraft.slice(1).toLowerCase() : null;
  const slashMatches = slashTerm === null ? [] : availableReplies
    .filter((reply) => reply.shortcut.startsWith(slashTerm) || reply.message.toLowerCase().includes(slashTerm))
    .slice(0, 6);
  const updateComposerDraft = (value) => {
    setSlashIndex(0);
    if (isNoteMode) setNoteDraft(value);
    else updateActiveReply(value);
  };
  const saveInternalNote = async () => {
    const message = noteDraft.trim();
    if (!message || actionBusy || !canWriteNote) return;
    try {
      setActionBusy("note");
      setError("");
      setActionMessage("");
      if (mode === "ticket") {
        await leafAPI.sendSupportMessage(selectedTicket.id, message, "internal_note", [], supportApiContext);
        await loadTicketMessages(selectedTicket.id);
      } else {
        const response = await leafAPI.addSupportChatNote(noteUserId, message, supportApiContext);
        setChatNotes((current) => [...current, response.note]);
      }
      setNoteDraft("");
      setActionMessage("Nota interna salva. O cliente não vê.");
    } catch (err) {
      setError(err?.message || "Falha ao salvar nota interna");
    } finally {
      setActionBusy("");
    }
  };
  const submitComposer = () => (isNoteMode ? saveInternalNote() : sendActiveReply());
  const handleComposerKeyDown = (event) => {
    if (slashMatches.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSlashIndex((current) => (current + step + slashMatches.length) % slashMatches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        updateComposerDraft(slashMatches[Math.min(slashIndex, slashMatches.length - 1)].message);
        return;
      }
      if (event.key === "Escape") {
        updateComposerDraft("");
        return;
      }
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
    }
  };
  const focusComposer = (nextMode) => {
    setComposerMode(nextMode);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };
  const moveInboxSelection = (step) => {
    if (!inboxItems.length) return;
    const currentIndex = inboxItems.findIndex((item) => item.id === selectedInboxId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + step + inboxItems.length) % inboxItems.length;
    selectInboxItem(inboxItems[nextIndex]);
  };
  const shortcutHandlerRef = useRef(null);
  useEffect(() => {
    shortcutHandlerRef.current = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const tag = event.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key === "arrowdown" || key === "arrowup") {
        event.preventDefault();
        moveInboxSelection(key === "arrowdown" ? 1 : -1);
      } else if (key === "r" || key === "n") {
        event.preventDefault();
        focusComposer(key === "n" ? "note" : "reply");
      } else if (key === "d") {
        setContextOpen((current) => !current);
      } else if (key === "escape") {
        setContextOpen(false);
      }
    };
  });
  useEffect(() => {
    const onKeyDown = (event) => shortcutHandlerRef.current?.(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const addSavedReply = async () => {
    try {
      setActionBusy("saved-reply");
      setError("");
      const response = await leafAPI.saveSupportSavedReply(savedReplyForm.shortcut, savedReplyForm.message, supportApiContext);
      setSavedReplies((current) => [
        ...current.filter((reply) => reply.shortcut !== response.reply.shortcut),
        response.reply,
      ].sort((left, right) => left.shortcut.localeCompare(right.shortcut)));
      setSavedReplyForm({ shortcut: "", message: "" });
      setActionMessage("Resposta pronta salva.");
    } catch (err) {
      setError(err?.message || "Falha ao salvar resposta pronta");
    } finally {
      setActionBusy("");
    }
  };
  const removeSavedReply = async (shortcut) => {
    try {
      setActionBusy("saved-reply");
      setError("");
      await leafAPI.deleteSupportSavedReply(shortcut, supportApiContext);
      setSavedReplies((current) => current.filter((reply) => reply.shortcut !== shortcut));
      setActionMessage("Resposta pronta removida.");
    } catch (err) {
      setError(err?.message || "Falha ao remover resposta pronta");
    } finally {
      setActionBusy("");
    }
  };
  const rideCard = activeRide ? (
    <div className="support-ride-card" data-testid="support-ride-card">
      <div className="support-ride-main">
        <strong>Corrida {activeRide.statusLabel}</strong>
        <span>{formatMoney(activeRide.grossAmount)}</span>
        {activeRide.paymentStatus ? <span>Pagamento: {activeRide.paymentStatus}</span> : null}
      </div>
      {activeRide.pickupAddress || activeRide.destinationAddress ? (
        <p>{activeRide.pickupAddress || "Origem indisponível"} → {activeRide.destinationAddress || "Destino indisponível"}</p>
      ) : null}
      <div className="support-ride-links">
        {activeRide.passengerId ? (
          <a href={`/users/${encodeURIComponent(activeRide.passengerId)}`}>Passageiro: {activeRide.passengerName || "ver perfil"}</a>
        ) : null}
        {activeRide.driverId ? (
          <a href={`/drivers/${encodeURIComponent(activeRide.driverId)}`}>Motorista: {activeRide.driverName || "ver perfil"}</a>
        ) : null}
      </div>
    </div>
  ) : null;
  const threadComposer = (
    <div className={isNoteMode ? "support-composer support-composer-note" : "support-composer"}>
      {selectedWhatsAppWindow && !isNoteMode ? (
        <p className={whatsappReplyBlocked ? "support-channel-notice support-channel-notice-blocked" : "support-channel-notice"}>
          Contato externo: confirme a identidade antes de tratar dados da conta Leaf.
          {selectedN0Chat.pendingOperationId
            ? " Há um envio sem confirmação. Aguarde antes de reenviar."
            : whatsappReplyBlocked
              ? " Aguarde uma nova mensagem do contato para responder."
              : " Respostas de texto disponíveis por 24 horas após a última mensagem do contato."}
        </p>
      ) : null}
      {slashMatches.length ? (
        <div className="support-slash-menu" role="listbox" aria-label="Respostas prontas">
          {slashMatches.map((reply, index) => (
            <button
              key={reply.shortcut}
              type="button"
              role="option"
              aria-selected={index === Math.min(slashIndex, slashMatches.length - 1)}
              className={index === Math.min(slashIndex, slashMatches.length - 1) ? "support-slash-active" : ""}
              onMouseDown={(event) => {
                event.preventDefault();
                updateComposerDraft(reply.message);
              }}
            >
              <strong>/{reply.shortcut}</strong>
              <span>{reply.message}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="support-composer-modes" role="group" aria-label="Tipo de mensagem">
        <button type="button" aria-pressed={!isNoteMode} onClick={() => focusComposer("reply")}>Responder</button>
        <button type="button" aria-pressed={isNoteMode} onClick={() => focusComposer("note")}>Nota interna</button>
      </div>
      <textarea
        ref={composerInputRef}
        rows={1}
        aria-label={isNoteMode ? "Nota interna" : "Resposta ao cliente"}
        placeholder={isNoteMode
          ? "Nota para a equipe. O cliente não vê."
          : `${selectedWhatsAppWindow ? "Responder no WhatsApp" : mode === "ticket" ? "Responder chamado" : "Responder chat"}. Use / para respostas prontas`}
        value={composerDraft}
        onChange={(event) => updateComposerDraft(event.target.value)}
        onKeyDown={handleComposerKeyDown}
      />
      <button
        type="button"
        onClick={submitComposer}
        disabled={!!actionBusy || !composerDraft.trim() || (isNoteMode ? !canWriteNote : !canReplyActiveThread)}
      >
        {isNoteMode
          ? actionBusy === "note" ? "Salvando..." : "Salvar nota"
          : actionBusy === "message" || actionBusy === "n0-message" ? "Enviando..." : "Enviar"}
      </button>
    </div>
  );

  return (
    <ProtectedRoute>
      <main className={isDetachedWindow ? "page-shell support-page-shell support-page-detached" : "page-shell support-page-shell"}>
        <header className="header support-header">
          <div>
            <h1>Suporte</h1>
            {isSandboxSupportScope ? (
              <p>Fila sandbox isolada para validação de tickets; chats legados e integrações operacionais permanecem desativados.</p>
            ) : null}
          </div>
          <div className="filters support-header-filters">
            <span
              className={supportFreshnessStatus.className}
              data-testid="support-freshness-status"
              title={supportFreshnessStatus.detail}
            >
              {supportFreshnessStatus.label}
            </span>
            <span className="meta-badge" title="Notificações do chat">Chat: {chatRealtime}</span>
            {isDetachedWindow ? null : (
              <button type="button" className="mode-btn" onClick={openSupportWindow}>
                Abrir em janela
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                loadTickets({ silent: false });
                loadChatInbox();
              }}
            >
              Atualizar
            </button>
          </div>
        </header>
        {isDetachedWindow ? null : <AppNav />}
        {loading ? <LoadingState message="Carregando suporte..." /> : null}

        <section className="support-stat-bar" aria-label="Resumo da fila">
          <span className="support-stat"><strong>{summary.totalOpenTickets}</strong> abertos</span>
          <span className={summary.n1 > 0 ? "support-stat support-stat-bad" : "support-stat"}><strong>{summary.n1}</strong> N1</span>
          <span className={summary.n2 > 0 ? "support-stat support-stat-warn" : "support-stat"}><strong>{summary.n2}</strong> N2</span>
          <span className="support-stat"><strong>{summary.n3}</strong> N3</span>
          <span
            className={summary.overdueAckCount + summary.overdueFirstResponseCount > 0 ? "support-stat support-stat-bad" : "support-stat"}
            title={`${summary.overdueAckCount} ack vencido · ${summary.overdueFirstResponseCount} primeira resposta vencida`}
          >
            <strong>{summary.overdueAckCount + summary.overdueFirstResponseCount}</strong> SLA vencido
          </span>
          <span className={summary.ticketsWithoutOwner > 0 ? "support-stat support-stat-warn" : "support-stat"}>
            <strong>{summary.ticketsWithoutOwner}</strong> sem dono
          </span>
          <span className="support-stat" title="Mediana da primeira resposta nos tickets respondidos">
            <strong>{formatMinutes(summary.medianFirstResponseMinutes)}</strong> 1ª resposta
          </span>
          <span
            className={n0UnreadCount > 0 ? "support-stat support-stat-warn" : "support-stat"}
            title={`${channelSummary.app.unread} no app · ${channelSummary.whatsapp.unread} no WhatsApp`}
          >
            <strong>{n0UnreadCount}</strong> não lidas
          </span>
        </section>

        <section className={contextOpen ? "support-inbox-layout support-inbox-layout-context" : "support-inbox-layout"}>
          <aside className="support-inbox-panel card">
            {isOperationalSupportScope ? (
              <div className="support-channel-tabs" role="tablist" aria-label="Canal de atendimento">
                {SUPPORT_CHANNELS.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    role="tab"
                    aria-selected={inboxChannel === channel.id}
                    className={inboxChannel === channel.id ? "support-channel-tab support-channel-tab-active" : "support-channel-tab"}
                    onClick={() => selectInboxChannel(channel.id)}
                  >
                    {channel.label}
                    <span className="support-channel-count">{channelSummary[channel.id].total}</span>
                    {channelSummary[channel.id].unread > 0 ? (
                      <span className="support-unread-pill" title="Mensagens não lidas">
                        {channelSummary[channel.id].unread}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="support-inbox-head">
                <h2>Chamados sandbox</h2>
              </div>
            )}
            <div className="support-inbox-tabs">
              {INBOX_FILTERS[inboxChannel].map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={inboxFilter === filter.id ? "mode-btn mode-btn-active" : "mode-btn"}
                  onClick={() => setInboxFilter(filter.id)}
                >
                  {filter.label}
                  {queueCounts[filter.id] && inboxChannel === "app" ? (
                    <span className="support-queue-count">{queueCounts[filter.id]}</span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="support-inbox-search">
              <input
                placeholder={inboxChannel === "whatsapp" ? "Buscar nome, telefone ou mensagem" : "Buscar usuário, mensagem ou corrida"}
                value={ticketSearch}
                onChange={(event) => setTicketSearch(event.target.value)}
              />
            </div>
            {inboxChannel === "app" ? (
              <div className="support-inbox-filters">
                <select
                  aria-label="Tipo de atendimento"
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                >
                  <option value="all">Tipo</option>
                  <option value="chats">Só chats</option>
                  <option value="tickets">Só chamados</option>
                </select>
                <select
                  aria-label="Prioridade do chamado"
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value)}
                >
                  <option value="all">Prioridade</option>
                  <option value="N1">N1</option>
                  <option value="N2">N2</option>
                  <option value="N3">N3</option>
                </select>
                <select
                  aria-label="Status do chamado"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">Status</option>
                  <option value="open">Abertos</option>
                  <option value="assigned">Atribuídos</option>
                  <option value="in_progress">Em andamento</option>
                  <option value="escalated">Escalados</option>
                  <option value="resolved">Resolvidos</option>
                  <option value="closed">Fechados</option>
                </select>
              </div>
            ) : null}
            {isOperationalSupportScope && typeFilter !== "tickets" ? (
              <label className="support-inbox-toggle">
                <input
                  type="checkbox"
                  checked={showClosedN0Chats}
                  onChange={(event) => setShowClosedN0Chats(event.target.checked)}
                />
                Mostrar conversas encerradas
              </label>
            ) : null}
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
                  <span
                    className={item.channel === "whatsapp" ? "support-thread-avatar support-avatar-whatsapp" : "support-thread-avatar"}
                  >
                    {item.title.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="support-thread-main">
                    <span className="support-thread-title-row">
                      <strong>{item.title}</strong>
                      <small>{formatThreadTime(item.timestamp)}</small>
                    </span>
                    {item.subtitle ? <span className="support-thread-subtitle">{item.subtitle}</span> : null}
                    <span className="support-thread-preview">{item.preview}</span>
                    <span className="support-thread-badges">
                      {item.type === "ticket" && !item.badge.startsWith(item.priority) ? (
                        <span className={priorityBadge(item.priority)}>{item.priority}</span>
                      ) : null}
                      {item.channel === "app" ? (
                        <span className={statusBadge(item.status)}>{supportStatusLabel(item.status)}</span>
                      ) : null}
                      <span className={item.tone}>{item.badge}</span>
                    </span>
                  </span>
                  {item.unread > 0 ? <span className="support-unread-pill">{item.unread}</span> : null}
                </button>
              ))}
              {inboxItems.length === 0 ? (
                <p className="text-muted">
                  {inboxChannel === "whatsapp"
                    ? "Nenhuma conversa de WhatsApp neste filtro."
                    : "Nenhuma conversa ou chamado do app neste filtro."}
                </p>
              ) : null}
            </div>
            <p className="support-shortcut-hint">↑↓ navegar · R responder · N nota · D dados · / respostas</p>
          </aside>

          <section className="support-conversation-panel card">
            {mode === "n0" ? (
              selectedN0Chat ? (
                <>
	                <div className="support-conversation-head">
	                  <div className={selectedWhatsAppWindow ? "support-conversation-avatar support-avatar-whatsapp" : "support-conversation-avatar"}>{activeThreadTitle.slice(0, 1).toUpperCase()}</div>
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
                              : selectedWhatsAppWindow
                                ? "Contato de WhatsApp não tem conta Leaf verificada."
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
                        onClick={requestCloseN0Chat}
                      >
                        Encerrar
                      </button>
                      {contextToggle}
                    </div>
                  </div>
                  {threadContextBar}
                  {rideCard}
                  <div className="support-messages support-conversation-messages" ref={threadMessagesRef}>
                    <SupportMessageBubbles messages={filteredMessages} emptyText="Sem histórico neste chat." />
                  </div>
                  {threadComposer}
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
                    {contextToggle}
                  </div>
                </div>
                {threadContextBar}
                  {rideCard}
                <div className="support-messages support-conversation-messages" ref={threadMessagesRef}>
                  <SupportMessageBubbles messages={filteredMessages} emptyText="Sem mensagens neste canal." />
                </div>
                {threadComposer}
              </>
            ) : (
              <p className="text-muted">Selecione uma conversa ou chamado.</p>
            )}
          </section>

          {contextOpen ? (
          <aside className="support-context-panel card">
            <div className="support-context-head">
              <h2>Dados do atendimento</h2>
              <button type="button" className="mode-btn" onClick={() => setContextOpen(false)}>Fechar</button>
            </div>
            <div className="support-context-section">
              <h2>Contexto</h2>
              {mode === "n0" && selectedWhatsAppWindow ? (
                <KeyValueGrid
                  data={{
                    nome: getChatName(selectedN0Chat),
                    telefone: formatPhone(selectedN0Chat.phone),
                    identidade: "Não verificada",
                    janela: selectedWhatsAppWindow.label.replace("Janela: ", ""),
                  }}
                  labels={{ nome: "Nome", telefone: "Telefone", identidade: "Conta Leaf", janela: "Resposta livre" }}
                />
              ) : activeContextUserId ? (
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

            {mode === "n0" && selectedN0Chat && !selectedWhatsAppWindow ? (
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
                  <button
                    type="button"
                    disabled={!!actionBusy || !canResolveSelected || !manualResolution.trim()}
                    onClick={resolveTicket}
                  >
                    Resolver
                  </button>
                  {mode === "chat" ? (
                    <button
                      type="button"
                      disabled={
                        chatStatus?.status === "closed" ||
                        !canRunSupportAction(supportPolicy, "close_chat", selectedTicketTier)
                      }
                      onClick={requestCloseChat}
                    >
                      Encerrar chat
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {canManageSavedReplies ? (
              <div className="support-context-section">
                <h2>Respostas prontas</h2>
                {savedReplies.length ? (
                  <ul className="support-saved-replies">
                    {savedReplies.map((reply) => (
                      <li key={reply.shortcut} title={reply.message}>
                        <strong>/{reply.shortcut}</strong>
                        <span>{reply.message}</span>
                        <button
                          type="button"
                          className="mode-btn"
                          disabled={!!actionBusy}
                          onClick={() => removeSavedReply(reply.shortcut)}
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">Usando as respostas padrão até você salvar a primeira.</p>
                )}
                <input
                  placeholder="Atalho, ex: pix"
                  aria-label="Atalho da resposta pronta"
                  value={savedReplyForm.shortcut}
                  onChange={(event) => setSavedReplyForm((current) => ({ ...current, shortcut: event.target.value }))}
                />
                <textarea
                  rows={2}
                  placeholder="Texto da resposta"
                  aria-label="Texto da resposta pronta"
                  value={savedReplyForm.message}
                  onChange={(event) => setSavedReplyForm((current) => ({ ...current, message: event.target.value }))}
                />
                <button
                  type="button"
                  disabled={!!actionBusy || !savedReplyForm.shortcut.trim() || !savedReplyForm.message.trim()}
                  onClick={addSavedReply}
                >
                  Salvar resposta
                </button>
              </div>
            ) : null}

            <div className="support-context-section">
              <h2>Operação</h2>
              <div className="orchestrator-summary">
                <span className={supportOpsStatus.className}>{supportOpsStatus.label}</span>
                <span
                  className={supportFreshnessStatus.className}
                  data-testid="support-freshness-ops"
                  title={supportFreshnessStatus.detail}
                >
                  {supportFreshnessStatus.label}
                </span>
                <span className="meta-badge">tempo real: {chatRealtime}</span>
                <span className="meta-badge">{supportPolicy.label}</span>
              </div>
              <p className="text-muted">{supportOpsStatus.detail}</p>
              <p className="text-muted" data-testid="support-freshness-detail">
                {supportFreshnessStatus.detail}
              </p>
            </div>
          </aside>
          ) : null}
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
              <span className={ticketsFreshness.className}>{ticketsFreshness.label}</span>
              <span className={inboxFreshness.className}>{inboxFreshness.label}</span>
              <span className={activeMessagesFreshness.className}>{activeMessagesFreshness.label}</span>
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
                    {getTicketClassificationLabel(ticket) ? (
                      <span className="table-muted">
                        Classificação: {getTicketClassificationLabel(ticket)}
                      </span>
                    ) : null}
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
                    onClick={requestCloseChat}
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
                    classificacao: "Classificação",
                    origemSeveridade: "Origem da severidade",
                    racionalSeveridade: "Racional",
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
                  maxItems={16}
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
                    onClick={requestCloseN0Chat}
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
                    disabled={!!actionBusy || whatsappReplyBlocked || !n0ChatReply.trim() || !canRunSupportAction(supportPolicy, "message", "N3")}
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
        {confirmationDialog}
      </main>
    </ProtectedRoute>
  );
}

function SupportPageScopeBoundary() {
  const searchParams = useSearchParams();
  const supportScope = String(searchParams.get("scope") || "operational").trim().toLowerCase();
  return <SupportPageContent key={supportScope} supportScope={supportScope} />;
}

export default function SupportPage() {
  return (
    <Suspense fallback={<LoadingState message="Carregando escopo de suporte..." />}>
      <SupportPageScopeBoundary />
    </Suspense>
  );
}
