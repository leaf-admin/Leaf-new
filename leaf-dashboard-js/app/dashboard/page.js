"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import Panel from "@/src/components/ui/Panel";
import RidesTrendChart from "@/src/components/ui/RidesTrendChart";
import TechnicalHealth from "@/src/components/ops/TechnicalHealth";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { formatWaiting, subscribeOpsPending, waitingTone } from "@/src/services/ops-pending-store";

const DASHBOARD_REFRESH_MS = 60000;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCompact(value) {
  const numeric = toNumber(value);
  return numeric.toLocaleString("pt-BR", {
    maximumFractionDigits: numeric >= 1000 ? 1 : 0,
    notation: numeric >= 10000 ? "compact" : "standard",
  });
}

function formatPercent(value) {
  return `${(toNumber(value) * 100).toFixed(1)}%`;
}

function formatPercentValue(value) {
  return `${toNumber(value).toFixed(1)}%`;
}

function brlFromCents(value) {
  return `R$ ${(toNumber(value) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function brlFromValue(value, maximumFractionDigits = 2) {
  return `R$ ${toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  })}`;
}

function formatUsd(value) {
  return `US$ ${toNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
}

function formatMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)} min`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusTone(status) {
  if (status === "healthy") return "positive";
  if (status === "warning") return "warning";
  return "danger";
}

function statusClass(status) {
  if (status === "healthy") return "status-ok";
  if (status === "warning") return "status-warn";
  return "status-bad";
}

function statusLabel(status) {
  if (status === "healthy") return "Operação saudável";
  if (status === "warning") return "Atenção operacional";
  return "Ação necessária";
}

function ActionItems({ items = [] }) {
  if (!items.length) return <p className="text-muted">Sem ações sugeridas agora.</p>;
  return (
    <div className="metric-list">
      {items.map((item, index) => (
        <div className="row" key={item.id || `${item.title || item.label || "item"}-${index}`}>
          <div className="label">
            <span
              className={
                item.priority === "alta"
                  ? "status-bad"
                  : item.priority === "media"
                    ? "status-warn"
                    : "status-ok"
              }
            >
              {item.title || item.label || "Ação operacional"}
            </span>
            <small>{item.description || item.detail || "Verificar no fluxo indicado."}</small>
          </div>
          <div className="value">
            <Link href={item.href || "/dashboard"}>{item.priority || item.status || "ver"}</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildAttentionItems(snapshot) {
  const launchFlags = snapshot?.launchFlags || {};
  const items = Array.isArray(snapshot?.actionItems) ? snapshot.actionItems : [];
  return items
    .filter((item) => launchFlags.campaignCenterEnabled === true || !String(item.id || "").startsWith("campaigns-"))
    .sort((left, right) => {
      const rank = { alta: 0, media: 1, baixa: 2 };
      return (rank[left.priority] ?? 3) - (rank[right.priority] ?? 3);
    })
    .slice(0, 6);
}

function CommandStat({ label, value, detail, tone = "default" }) {
  return (
    <article className={`ops-command-stat ops-command-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

// Lista curta do que pede ação: só entra o que tem pendência.
const REVIEW_REASON_LABELS = {
  ready_to_approve: ["pronto para aprovar", "prontos para aprovar"],
  background_certificate: ["certidão de antecedentes", "certidões de antecedentes"],
  documents: ["com documento para revisar", "com documentos para revisar"],
  manual_review: ["em revisão manual", "em revisão manual"],
};

function describeReviewReasons(byReason = {}) {
  return Object.entries(REVIEW_REASON_LABELS)
    .map(([key, [one, many]]) => {
      const count = toNumber(byReason[key]);
      return count > 0 ? `${count} ${count === 1 ? one : many}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}

function buildTodoItems(snapshot, attentionItems = [], pending = null) {
  const metrics = snapshot?.dailyMetrics || {};
  const support = snapshot?.support || {};
  const driverOnboarding = snapshot?.driverOnboarding || {};
  const supportBreaches = toNumber(support.overdueAckCount) + toNumber(support.overdueFirstResponseCount);
  const items = [];
  const reviewDrivers = toNumber(pending?.drivers?.review);
  if (pending) {
    if (reviewDrivers > 0) {
      const oldestMs = pending.drivers?.oldestWaitingMs;
      const reasons = describeReviewReasons(pending.drivers?.byReason);
      items.push({
        id: "drivers",
        tone: waitingTone(oldestMs) === "bad" ? "bad" : "warn",
        href: "/drivers?tab=review",
        title: `${reviewDrivers} ${reviewDrivers === 1 ? "cadastro de motorista" : "cadastros de motorista"} para revisar`,
        detail: [reasons, oldestMs ? `o mais antigo espera há ${formatWaiting(oldestMs)}` : null].filter(Boolean).join(" · "),
      });
    }
    const cpfReviews = toNumber(pending.cpfReviews);
    if (cpfReviews > 0) {
      items.push({ id: "cpf", tone: "warn", href: "/users", title: `${cpfReviews} ${cpfReviews === 1 ? "conta com CPF em revisão" : "contas com CPF em revisão"}`, detail: "CPF repetido em outra conta" });
    }
  } else {
    const pendingDocs = toNumber(driverOnboarding.pendingDocuments);
    if (pendingDocs > 0) {
      items.push({ id: "drivers", tone: "warn", href: "/drivers?tab=review", title: `${pendingDocs} ${pendingDocs === 1 ? "documento de motorista" : "documentos de motorista"} para revisar`, detail: "Aprovar ou pedir reenvio" });
    }
  }
  const openTickets = toNumber(support.totalOpenTickets);
  if (openTickets > 0) {
    items.push({ id: "support", tone: supportBreaches > 0 ? "bad" : "warn", href: "/support", title: `${openTickets} ${openTickets === 1 ? "chamado aberto" : "chamados abertos"} no suporte`, detail: supportBreaches > 0 ? `${supportBreaches} fora do prazo` : "Dentro do prazo" });
  }
  const pendingPayments = toNumber(metrics.paymentPendingCount);
  if (pendingPayments > 0) {
    items.push({ id: "payments", tone: "warn", href: "/financial-reconciliation", title: `${pendingPayments} ${pendingPayments === 1 ? "pagamento pendente" : "pagamentos pendentes"}`, detail: "Conferir na reconciliação" });
  }
  attentionItems
    .filter((item) => item.priority === "alta" || item.priority === "media")
    .forEach((item, index) => {
      items.push({
        id: `attention-${item.id || index}`,
        tone: item.priority === "alta" ? "bad" : "warn",
        href: item.href || "/observability",
        title: item.title || item.label || "Alerta operacional",
        detail: item.description || item.detail || null,
      });
    });
  return items;
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    let firstLoad = true;

    const load = async () => {
      try {
        if (mounted && firstLoad) setLoading(true);
        if (mounted) setError("");
        const payload = await leafAPI.getCommandCenterSnapshot({ hours: 1, period: "today" });
        if (mounted) setSnapshot(payload);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar command center");
      } finally {
        if (mounted) {
          setLoading(false);
          firstLoad = false;
        }
      }
    };

    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    load();
    const timer = setInterval(loadWhenVisible, DASHBOARD_REFRESH_MS);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, []);

  // Daily series for the chart: its own request, so a slow series never delays the numbers.
  const [series, setSeries] = useState(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState("");
  useEffect(() => {
    let mounted = true;
    leafAPI.getRidesSeries(14)
      .then((payload) => { if (mounted) setSeries(payload); })
      .catch(() => { if (mounted) setSeriesError("Série diária indisponível agora."); })
      .finally(() => { if (mounted) setSeriesLoading(false); });
    return () => { mounted = false; };
  }, []);

  const attentionItems = useMemo(() => buildAttentionItems(snapshot), [snapshot]);
  const [pending, setPending] = useState(null);
  useEffect(() => subscribeOpsPending((state) => setPending(state.summary)), []);
  const todoItems = useMemo(() => buildTodoItems(snapshot, attentionItems, pending), [snapshot, attentionItems, pending]);
  const metrics = snapshot?.dailyMetrics || {};
  const services = snapshot?.services || {};
  const costControls = snapshot?.costControls || {};
  const firestoreReadGuard = costControls.firestoreReadGuard || {};

  return (
    <ProtectedRoute>
      <main className="page-shell dashboard-shell">
        <header className="header dashboard-header">
          <div>
            <h1>Hoje</h1>
            <p>Atualizado às {formatTime(snapshot?.generatedAt)}</p>
          </div>
          <div className="filters">
            <span className={statusClass(snapshot?.status)}>
              {statusLabel(snapshot?.status)}
            </span>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando operação diária..." /> : null}

        <section className="home-stats" aria-label="Resumo de hoje">
          <CommandStat
            label="Motoristas online"
            value={formatCompact(metrics.activeDrivers)}
            detail={`${formatCompact(metrics.totalDrivers)} cadastrados`}
          />
          <CommandStat
            label="Corridas agora"
            value={formatCompact(metrics.activeRides)}
            detail={`${formatCompact(metrics.completedRidesToday)} finalizadas hoje`}
          />
          <CommandStat
            label="GMV hoje"
            value={brlFromCents(metrics.gmvCents)}
            detail={`ticket médio ${brlFromCents(metrics.averageRideTicketCents)}`}
          />
          <CommandStat
            label="Receita Leaf hoje"
            value={brlFromCents(metrics.grossRevenueCents)}
          />
        </section>

        <RidesTrendChart days={series?.days || []} loading={seriesLoading} error={seriesError} />

        <section className="home-todo card" aria-label="Precisa de você">
          <div className="home-todo-head">
            <h2>Precisa de você</h2>
            <span className="table-muted">{todoItems.length ? `${todoItems.length} ${todoItems.length === 1 ? "item" : "itens"}` : "Tudo em dia"}</span>
          </div>
          {todoItems.length === 0 ? (
            <p className="home-todo-empty">Nada pendente agora. Motoristas, suporte e pagamentos estão em dia.</p>
          ) : (
            <ul className="home-todo-list">
              {todoItems.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="home-todo-row">
                    <span className={`home-todo-dot home-todo-dot-${item.tone}`} aria-hidden="true" />
                    <span className="home-todo-copy">
                      <strong>{item.title}</strong>
                      {item.detail ? <span>{item.detail}</span> : null}
                    </span>
                    <span className="home-todo-open" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <details className="ops-technical">
          <summary>
            <span>Saúde técnica e custos</span>
            <small>Serviços, custo do dia, custo por corrida e canary</small>
          </summary>
          <TechnicalHealth snapshot={snapshot} />
        </details>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
