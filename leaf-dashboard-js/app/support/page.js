"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import { ErrorText } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import { wsService } from "@/src/services/websocket-service";

export default function SupportPage() {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatStatus, setChatStatus] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");
  const [wsStatus, setWsStatus] = useState("conectando");
  const [mode, setMode] = useState("ticket");

  const selectedUserId = selectedTicket?.userId || selectedTicket?.user?.id || null;

  useEffect(() => {
    let mounted = true;
    const loadTickets = async () => {
      try {
        const response = await leafAPI.getSupportTickets({
          status: statusFilter === "all" ? undefined : statusFilter,
          page: 1,
          limit: 100,
        });
        if (!mounted) return;
        const sorted = [...(response?.tickets || [])].sort(
          (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
        );
        setTickets(sorted);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar tickets");
      }
    };
    loadTickets();
    const timer = setInterval(loadTickets, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [statusFilter]);

  useEffect(() => {
    let active = true;
    const onNewTicket = (payload) => {
      const ticket = payload?.ticket;
      if (!ticket) return;
      setTickets((prev) => {
        if (prev.some((t) => t.id === ticket.id)) return prev;
        return [ticket, ...prev];
      });
    };
    const onUpdateTicket = (payload) => {
      const ticket = payload?.ticket;
      if (!ticket) return;
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, ...ticket } : t)));
    };

    wsService
      .connect()
      .then(() => {
        if (!active) return;
        setWsStatus("conectado");
        wsService.on("support:ticket:new", onNewTicket);
        wsService.on("support:ticket:updated", onUpdateTicket);
      })
      .catch(() => {
        if (active) setWsStatus("erro");
      });

    return () => {
      active = false;
      wsService.off("support:ticket:new", onNewTicket);
      wsService.off("support:ticket:updated", onUpdateTicket);
    };
  }, []);

  useEffect(() => {
    if (!selectedTicket) return;
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
    const timer = setInterval(loadTicketMessages, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedTicket]);

  useEffect(() => {
    if (!selectedUserId) return;
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
    const timer = setInterval(loadChatData, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selectedUserId]);

  useEffect(() => {
    const onNewTicketMessage = (payload) => {
      if (payload?.ticketId !== selectedTicket?.id) return;
      const message = payload?.message;
      if (!message) return;
      setTicketMessages((prev) => {
        const id = message.id || `${message.createdAt}-${message.message}`;
        if (prev.some((item) => (item.id || `${item.createdAt}-${item.message}`) === id)) return prev;
        return [...prev, message];
      });
    };

    const onNewChatMessage = (payload) => {
      const userId = payload?.userId;
      if (!userId || userId !== selectedUserId) return;
      const message = payload?.message;
      if (!message) return;
      setChatMessages((prev) => {
        const id = message.id || `${message.timestamp || message.createdAt}-${message.message}`;
        if (prev.some((item) => (item.id || `${item.createdAt}-${item.message}`) === id)) return prev;
        return [
          ...prev,
          {
            id,
            senderType: message.senderType || "user",
            message: message.message || "",
            createdAt: message.timestamp || message.createdAt || new Date().toISOString(),
          },
        ];
      });
    };

    wsService.on("support:message:new", onNewTicketMessage);
    wsService.on("support:chat:new", onNewChatMessage);
    return () => {
      wsService.off("support:message:new", onNewTicketMessage);
      wsService.off("support:chat:new", onNewChatMessage);
    };
  }, [selectedTicket, selectedUserId]);

  const currentMessages = useMemo(
    () => (mode === "ticket" ? ticketMessages : chatMessages),
    [mode, ticketMessages, chatMessages],
  );

  const sendMessage = async () => {
    if (!selectedTicket || !newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage("");
    try {
      if (mode === "chat" && selectedUserId) {
        await leafAPI.sendChatMessage(selectedUserId, text);
        if (wsService.isConnected()) {
          wsService.emit("support:chat:message", {
            userId: selectedUserId,
            message: text,
            senderType: "agent",
          });
        }
        const history = await leafAPI.getChatHistory(selectedUserId, 80);
        setChatMessages(history?.messages || []);
      } else {
        await leafAPI.sendSupportMessage(selectedTicket.id, text);
        if (wsService.isConnected()) {
          wsService.emit("support:message:send", {
            ticketId: selectedTicket.id,
            message: text,
          });
        }
        const response = await leafAPI.getSupportMessages(selectedTicket.id);
        setTicketMessages(response?.messages || []);
      }
    } catch (err) {
      setError(err?.message || "Falha ao enviar mensagem");
      setNewMessage(text);
    }
  };

  const closeChat = async () => {
    if (!selectedUserId) return;
    if (!window.confirm("Encerrar chat deste usuário?")) return;
    try {
      await leafAPI.closeChat(selectedUserId, "agent");
      const status = await leafAPI.getChatStatus(selectedUserId);
      setChatStatus(status?.status || null);
    } catch (err) {
      setError(err?.message || "Falha ao encerrar chat");
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Suporte</h1>
          <div className="filters">
            <span className={wsStatus === "conectado" ? "status-ok" : "status-warn"}>WS: {wsStatus}</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos</option>
              <option value="open">Abertos</option>
              <option value="in_progress">Em andamento</option>
              <option value="resolved">Resolvidos</option>
              <option value="closed">Fechados</option>
            </select>
          </div>
        </header>
        <AppNav />
        <section className="grid support-grid">
          <Panel title="Tickets">
            <div className="support-list">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  className={selectedTicket?.id === ticket.id ? "ticket-btn ticket-btn-active" : "ticket-btn"}
                  onClick={() => setSelectedTicket(ticket)}
                >
                  <strong>{ticket.subject || `Ticket ${ticket.id}`}</strong>
                  <span>
                    {ticket.status || "open"}
                    {ticket.priority ? ` • ${ticket.priority}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            title="Atendimento"
            actions={
              selectedTicket ? (
                <>
                  <button
                    className={mode === "ticket" ? "mode-btn mode-btn-active" : "mode-btn"}
                    onClick={() => setMode("ticket")}
                  >
                    Ticket
                  </button>
                  <button
                    className={mode === "chat" ? "mode-btn mode-btn-active" : "mode-btn"}
                    onClick={() => setMode("chat")}
                  >
                    Chat
                  </button>
                  {mode === "chat" ? (
                    <button onClick={closeChat} disabled={chatStatus?.status === "closed"}>
                      Encerrar chat
                    </button>
                  ) : null}
                </>
              ) : null
            }
          >
            {selectedTicket ? (
              <>
                {mode === "chat" ? (
                  <p className="text-muted">
                    Status do chat: <strong>{chatStatus?.status || "desconhecido"}</strong>
                  </p>
                ) : null}
                <div className="support-messages">
                  {currentMessages.map((message) => (
                    <div key={message.id || `${message.createdAt}-${message.message}`}>
                      <strong>{message.senderType || message.senderId || "user"}:</strong> {message.message || "-"}
                    </div>
                  ))}
                </div>
                <div className="filters">
                  <input
                    placeholder={mode === "chat" ? "Responder chat..." : "Responder ticket..."}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                  />
                  <button onClick={sendMessage}>Enviar</button>
                </div>
              </>
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
