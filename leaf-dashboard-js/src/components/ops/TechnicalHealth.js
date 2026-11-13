"use client";

// Saúde técnica e custos (home do painel). Resumo de 4 números no topo e o
// detalhe em abas, uma de cada vez. As explicações de origem dos dados ficam
// fechadas em "Como calculamos". Usa só o snapshot agregado do backend.

import Link from "next/link";
import { useMemo, useState } from "react";

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

function brlFromCents(value) {
  return `R$ ${(toNumber(value) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function brlFromValue(value, maximumFractionDigits = 2) {
  return `R$ ${toNumber(value).toLocaleString("pt-BR", { minimumFractionDigits: maximumFractionDigits, maximumFractionDigits })}`;
}

// Valores de centavos ou menos: mostra 4 casas para não virar "R$ 0,00".
function brlSmall(value) {
  const numeric = toNumber(value);
  const small = Math.abs(numeric) > 0 && Math.abs(numeric) < 0.1;
  return `R$ ${numeric.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 })}`;
}

function percentBr(value) {
  return `${toNumber(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function domainLabel(domain = {}) {
  return domain.label || domain.domain || domain.name || domain.id || "Serviço";
}

function sourceLabel(source = {}) {
  return source.label || source.name || source.id || "fonte";
}

function formatUsd(value) {
  return `US$ ${toNumber(value).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

function toneClass(tone) {
  if (tone === "ok") return "status-ok";
  if (tone === "warn") return "status-warn";
  if (tone === "bad") return "status-bad";
  return "meta-badge";
}

function domainTone(status) {
  if (status === "healthy") return "ok";
  if (status === "warning") return "warn";
  return "bad";
}

function sourceTone(status) {
  if (status === "ok") return "ok";
  if (status === "warning") return "warn";
  return "bad";
}

function costGuardTone(status) {
  if (status === "ok") return "ok";
  if (status === "warning") return "warn";
  if (!status) return "muted";
  return "bad";
}

function rideCostTone(status) {
  if (status === "danger") return "bad";
  if (status === "warning") return "warn";
  if (status === "healthy") return "ok";
  return "muted";
}

const RIDE_COST_LABELS = { danger: "crítico", warning: "atenção", healthy: "normal", no_data: "sem corridas" };

function runtimeEnvironmentLabel(environment) {
  if (environment === "sandbox") return "sandbox";
  if (environment === "production") return "produção";
  return "não definido";
}

function readinessClass(status) {
  if (status === "ready") return "status-ok";
  if (status === "attention") return "status-warn";
  return "status-bad";
}

function readinessLabel(status) {
  if (status === "ready") return "pronto";
  if (status === "attention") return "atenção";
  return "bloqueado";
}


function CanaryPackPanel({ canaryPack }) {
  if (!canaryPack) return <p className="text-muted">Canary Pack ainda não carregado.</p>;
  return (
    <div className="canary-pack">
      <div className="canary-pack-summary">
        <div>
          <span>Pagamento</span>
          <strong>{runtimeEnvironmentLabel(canaryPack.paymentRuntime?.defaultEnvironment)}</strong>
          <small>
            {canaryPack.paymentRuntime?.sandboxProfileCount || 0} perfil(is) sandbox ·{" "}
            {canaryPack.paymentRuntime?.canarySandboxEnabled ? "canary habilitado" : "canary por produção"}
          </small>
        </div>
        <Link href={canaryPack.paymentRuntime?.href || "/payment-runtime"}>Ajustar runtime</Link>
      </div>

      <div className="canary-readiness-grid">
        {(canaryPack.readiness || []).map((item) => (
          <article key={item.id} className="canary-readiness-item">
            <span className={readinessClass(item.status)}>{readinessLabel(item.status)}</span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>

      <div className="canary-link-row">
        {(canaryPack.links || []).map((link) => (
          <Link href={link.href} key={link.href}>{link.label}</Link>
        ))}
      </div>

      <details className="support-advanced-drawer">
        <summary>Checklist do canary</summary>
        <div className="canary-checklist-grid">
          <div>
            <h3>Passos</h3>
            <ul>
              {(canaryPack.flowSteps || []).map((step) => <li key={step}>{step}</li>)}
            </ul>
          </div>
          <div>
            <h3>Sucesso</h3>
            <ul>
              {(canaryPack.successCriteria || []).map((criterion) => <li key={criterion}>{criterion}</li>)}
            </ul>
          </div>
          <div>
            <h3>Falha</h3>
            <ul>
              {(canaryPack.failureCriteria || []).map((criterion) => <li key={criterion}>{criterion}</li>)}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}


const RIDE_ANOMALY_LABELS = {
  acima_critico: "acima do crítico",
  acima_alerta: "acima do aviso",
  acima_mediana: "muito acima da mediana",
  rotas_demais: "rotas demais",
  autocomplete_demais: "autocomplete demais",
};

function shortBookingId(bookingId) {
  const text = String(bookingId || "");
  return text.length > 22 ? `${text.slice(0, 22)}…` : text || "-";
}

function formatRideMoment(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Custo medido de cada corrida concluída, com a quebra por SKU. Clique na linha para abrir o detalhe.
function RideCostRidesTable({ anomaly }) {
  const [openId, setOpenId] = useState(null);
  const rides = Array.isArray(anomaly?.rides) ? anomaly.rides : [];
  const today = anomaly?.today || null;

  return (
    <div className="table-shell sku-table-shell">
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "baseline", margin: "0.5rem 0" }}>
        <strong>Custo por corrida</strong>
        <small>
          Mediana {brlSmall(anomaly?.medianBrl)} · {toNumber(anomaly?.anomalousRides)} fora do padrão
          {today ? ` · hoje: ${toNumber(today.rides)} corrida(s), ${brlSmall(today.totalBrl)} somados` : ""}
        </small>
      </div>
      <table className="table table-compact">
        <thead>
          <tr>
            <th>Corrida</th>
            <th>Custo</th>
            <th>Google</th>
            <th>Rotas</th>
            <th>SKU que mais pesou</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {rides.length ? rides.map((ride) => {
            const isOpen = openId === ride.bookingId;
            const top = Array.isArray(ride.skus) ? ride.skus[0] : null;
            const anomalies = Array.isArray(ride.anomalies) ? ride.anomalies : [];
            const tone = anomalies.includes("acima_critico") ? "status-bad" : anomalies.length ? "status-warn" : "status-ok";
            return [
              <tr
                key={ride.bookingId}
                onClick={() => setOpenId(isOpen ? null : ride.bookingId)}
                style={{ cursor: "pointer" }}
                aria-expanded={isOpen}
              >
                <td>
                  <strong title={ride.bookingId}>{shortBookingId(ride.bookingId)}</strong>
                  <span className="table-muted">{formatRideMoment(ride.completedAt)}</span>
                </td>
                <td>{brlFromValue(ride.totalBrl, 4)}</td>
                <td>{brlFromValue(ride.googleBrl, 4)}</td>
                <td>{formatCompact(ride.directionsRequests)}</td>
                <td>
                  {top ? (
                    <>
                      {top.label}
                      <span className="table-muted">{formatCompact(top.requests)} chamada(s) · {brlFromValue(top.costBrl, 4)}</span>
                    </>
                  ) : "-"}
                </td>
                <td>
                  <span className={tone}>
                    {anomalies.length ? anomalies.map((reason) => RIDE_ANOMALY_LABELS[reason] || reason).join(", ") : "normal"}
                  </span>
                </td>
              </tr>,
              isOpen ? (
                <tr key={`${ride.bookingId}-detail`}>
                  <td colSpan={6}>
                    <div className="table-muted" style={{ marginBottom: "0.25rem" }}>{ride.bookingId}</div>
                    {(ride.skus || []).length ? (
                      <table className="table table-compact">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Chamadas</th>
                            <th>Custo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ride.skus.map((sku) => (
                            <tr key={sku.key}>
                              <td>{sku.label}</td>
                              <td>{formatCompact(sku.requests)}</td>
                              <td>{brlFromValue(sku.costBrl, 4)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td>Backend, Redis, Firebase e infra</td>
                            <td>-</td>
                            <td>{brlFromValue(ride.otherBrl, 4)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <small>Sem chamadas Google registradas nesta corrida.</small>
                    )}
                  </td>
                </tr>
              ) : null,
            ];
          }) : (
            <tr>
              <td colSpan={6}>Nenhuma corrida concluída com telemetria de custo na janela recente.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SummaryTile({ label, value, detail, tone = "muted", onClick, active }) {
  return (
    <button
      type="button"
      className={`tech-summary-tile tech-summary-${tone}${active ? " tech-summary-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="tech-summary-label">{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </button>
  );
}

function ServicesView({ domains = [], sources = [] }) {
  const problems = domains.filter((domain) => domain.status !== "healthy");
  const healthy = domains.filter((domain) => domain.status === "healthy");
  const slowSources = sources.filter((source) => !["ok", "cached"].includes(source.status));
  return (
    <div className="tech-view">
      {problems.length ? (
        <ul className="tech-problem-list">
          {problems.map((domain) => (
            <li key={domain.id || domainLabel(domain)}>
              <span className={toneClass(domainTone(domain.status))}>{domain.status === "warning" ? "atenção" : "falha"}</span>
              <div>
                <strong>{domainLabel(domain)}</strong>
                {domain.action || domain.detail ? <p>{domain.action || domain.detail}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tech-all-good">Todos os {domains.length} serviços estão saudáveis.</p>
      )}

      {healthy.length ? (
        <div className="tech-chip-row" aria-label="Serviços saudáveis">
          {healthy.map((domain) => (
            <span key={domain.id || domainLabel(domain)} className="tech-chip" title={domain.action || domain.detail || ""}>
              <span className="tech-dot tech-dot-ok" aria-hidden="true" />
              {domainLabel(domain)}
            </span>
          ))}
        </div>
      ) : null}

      <details className="tech-more">
        <summary>
          Fontes do snapshot ({sources.length}){slowSources.length ? ` · ${slowSources.length} com problema` : ""}
        </summary>
        <table className="table table-compact tech-table">
          <thead>
            <tr><th>Fonte</th><th>Situação</th><th className="tech-num">Tempo</th></tr>
          </thead>
          <tbody>
            {sources.map((source, index) => (
              <tr key={`${source.id || source.label}-${index}`}>
                <td>{sourceLabel(source)}</td>
                <td>
                  <span className={toneClass(source.status === "cached" ? "ok" : sourceTone(source.status))}>
                    {["ok", "cached"].includes(source.status) ? (source.status === "cached" ? "cache" : "ok") : source.error || (source.status === "warning" ? "atenção" : "falhou")}
                  </span>
                </td>
                <td className="tech-num">{source.durationMs !== undefined && source.durationMs !== null ? `${source.durationMs} ms` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tech-footnote"><Link href="/observability">Abrir observabilidade</Link></p>
      </details>
    </div>
  );
}

function CostsView({ costControls = {}, snapshot }) {
  const skuMonitor = costControls.skuMonitor || {};
  const finance = skuMonitor.finance || {};
  const guard = costControls.firestoreReadGuard || {};
  const rows = Array.isArray(skuMonitor.rows) ? skuMonitor.rows : [];
  const feeToday = toNumber(finance.operationalFeeTotalCents);
  const infraToday = toNumber(finance.projectedCostWithoutWooviTodayCents);
  const wooviToday = toNumber(finance.projectedWooviTodayCents);
  const netToday = toNumber(finance.netAfterAllCents, feeToday - infraToday - wooviToday);
  const partial = finance.costTodaySource === "soma_real_mais_projecao" || finance.costTodaySource === "projecao_media";

  return (
    <div className="tech-view">
      <div className="tech-equation" aria-label="Conta do dia">
        <div><span>Taxa Leaf hoje</span><strong>{brlFromCents(feeToday)}</strong></div>
        <span className="tech-op" aria-hidden="true">−</span>
        <div><span>Infra{partial ? " (parte estimada)" : ""}</span><strong>{brlFromCents(infraToday)}</strong></div>
        <span className="tech-op" aria-hidden="true">−</span>
        <div><span>Woovi</span><strong>{brlFromCents(wooviToday)}</strong></div>
        <span className="tech-op" aria-hidden="true">=</span>
        <div className="tech-equation-result">
          <span>Líquido</span>
          <strong className={netToday < 0 ? "status-bad" : ""}>{brlFromCents(netToday)}</strong>
        </div>
      </div>

      <dl className="tech-facts">
        <div><dt>Taxa média por corrida</dt><dd>{brlFromCents(finance.operationalFeeAverageCents)}</dd></div>
        <div><dt>Custo variável por corrida</dt><dd>{brlFromCents(finance.variableCostWithoutWooviPerRideCents)} <small>{percentBr(finance.costRatioPercent)} da taxa</small></dd></div>
        <div><dt>Margem após infra</dt><dd>{percentBr(finance.marginAfterInfraPercent)}</dd></div>
        <div><dt>Leituras do painel hoje</dt><dd>{formatCompact(guard.dailyEstimatedFirestoreReads)} de {formatCompact(guard.dailyBudgetReads)} <small>{formatUsd(guard.dailyEstimatedUsd)}</small></dd></div>
      </dl>

      <h3 className="tech-subtitle">Custo por fornecedor <small>{formatCompact(skuMonitor.sampledRides)} corrida(s) na janela recente</small></h3>
      {rows.length ? (
        <div className="table-shell">
          <table className="table table-compact tech-table">
            <thead>
              <tr>
                <th>Serviço</th>
                <th className="tech-num">Uso</th>
                <th className="tech-num">Unitário</th>
                <th className="tech-num">Janela</th>
                <th className="tech-num">Projeção hoje</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.sku}</strong>
                    <span className="table-muted">{row.provider}</span>
                  </td>
                  <td className="tech-num">{formatCompact(row.usage)} <span className="table-muted">{row.unitLabel}</span></td>
                  <td className="tech-num">{brlSmall(row.unitCostBrl)}</td>
                  <td className="tech-num">{brlSmall(row.totalCostBrl)}</td>
                  <td className="tech-num">{brlFromCents(row.projectedTodayCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">Sem telemetria recente de corrida. A tabela enche depois das próximas corridas.</p>
      )}

      <details className="tech-more">
        <summary>Como calculamos</summary>
        <ul className="tech-notes">
          <li>Cada corrida concluída tem o custo medido dela: chamadas de cada serviço vezes o preço de tabela. O dia soma essas corridas; as que não mandaram relatório entram pela média.</li>
          <li>Woovi fica separado da infra para a reconciliação. O Google fatura o total por serviço: confira o mês contra a fatura.</li>
          <li>Leituras do painel: contador no Redis a cada requisição, a US$ {guard.readPriceUsdPer100k ?? 0.06} por 100 mil leituras. Situação hoje: <span className={toneClass(costGuardTone(guard.budgetStatus))}>{percentBr(guard.budgetUsagePercent)} do teto</span>.</li>
          <li>Snapshot em cache no Redis ({snapshot?.cache?.status || "-"}, idade {snapshot?.cache?.ageSeconds ?? "-"} s, TTL {snapshot?.scope?.ttlSeconds || 90} s). O navegador não chama Google, Woovi nem Firebase direto{costControls.externalPaidApisCalled ? " — mas este snapshot registrou chamada paga: verificar" : ""}.</li>
          {(skuMonitor.notes || []).slice(0, 4).map((note) => <li key={note}>{note}</li>)}
        </ul>
      </details>
    </div>
  );
}

function RidesView({ anomaly }) {
  if (!anomaly) return <p className="text-muted">Custo por corrida ainda não avaliado.</p>;
  const tone = rideCostTone(anomaly.status);
  return (
    <div className="tech-view">
      {anomaly.status === "warning" || anomaly.status === "danger" ? (
        <div className={`tech-alert tech-alert-${tone}`}>
          <strong>{anomaly.status === "danger" ? "Custo por corrida crítico" : "Custo por corrida acima do aviso"}</strong>
          <span>
            Média {brlSmall(anomaly.averageBrl)} · {toNumber(anomaly.aboveWarningCount)} de {toNumber(anomaly.completedRides)} acima de {brlFromValue(anomaly.warningThreshold)}
            {toNumber(anomaly.aboveCriticalCount) > 0 ? ` · ${anomaly.aboveCriticalCount} acima de ${brlFromValue(anomaly.criticalThreshold)}` : ""}
          </span>
          <small>Google médio {brlSmall(anomaly.averageGoogleBrl)} · {toNumber(anomaly.directionsPerRide).toFixed(2)} rotas por corrida · máxima {brlSmall(anomaly.maxBrl)}</small>
        </div>
      ) : null}
      <RideCostRidesTable anomaly={anomaly} />
    </div>
  );
}

const TABS = [
  { id: "services", label: "Serviços" },
  { id: "costs", label: "Custos" },
  { id: "rides", label: "Corridas" },
  { id: "canary", label: "Canary" },
];

export default function TechnicalHealth({ snapshot }) {
  const services = snapshot?.services || {};
  const costControls = snapshot?.costControls || {};
  const sources = Array.isArray(services.sources) ? services.sources : [];
  const anomaly = costControls.rideCostAnomaly || null;
  const domains = useMemo(
    () => (Array.isArray(snapshot?.services?.domainHealth) ? snapshot.services.domainHealth : []),
    [snapshot],
  );
  const problems = useMemo(() => domains.filter((domain) => domain.status !== "healthy"), [domains]);
  const defaultTab = problems.length ? "services" : "costs";
  const [tab, setTab] = useState(null);
  const activeTab = tab || defaultTab;

  const summary = useMemo(() => {
    const finance = snapshot?.costControls?.skuMonitor?.finance || {};
    const guard = snapshot?.costControls?.firestoreReadGuard || {};
    const badDomain = problems.some((domain) => domain.status !== "warning");
    return {
      services: {
        value: domains.length ? `${domains.length - problems.length} de ${domains.length}` : "-",
        detail: problems.length ? `Com problema: ${problems.map((domain) => domainLabel(domain)).join(", ")}` : "todos saudáveis",
        tone: !domains.length ? "muted" : badDomain ? "bad" : problems.length ? "warn" : "ok",
      },
      costs: {
        value: brlFromCents(finance.projectedCostWithoutWooviTodayCents),
        detail: `líquido do dia ${brlFromCents(finance.netAfterAllCents)}`,
        tone: toNumber(finance.netAfterAllCents) < 0 ? "bad" : "ok",
      },
      rides: {
        value: anomaly && anomaly.status !== "no_data" ? brlSmall(anomaly.averageBrl) : "-",
        detail: anomaly
          ? `${RIDE_COST_LABELS[anomaly.status] || "sem dados"}${anomaly.status !== "no_data" ? ` · ${toNumber(anomaly.completedRides)} corrida(s)` : ""}`
          : "não avaliado",
        tone: rideCostTone(anomaly?.status),
      },
      reads: {
        value: percentBr(guard.budgetUsagePercent),
        detail: `do teto de leituras · ${formatUsd(guard.dailyEstimatedUsd)} hoje`,
        tone: costGuardTone(guard.budgetStatus),
      },
    };
  }, [anomaly, domains, problems, snapshot]);

  return (
    <div className="tech-health">
      <div className="tech-summary">
        <SummaryTile label="Serviços" {...summary.services} onClick={() => setTab("services")} active={activeTab === "services"} />
        <SummaryTile label="Custo de infra hoje" {...summary.costs} onClick={() => setTab("costs")} active={activeTab === "costs"} />
        <SummaryTile label="Custo médio por corrida" {...summary.rides} onClick={() => setTab("rides")} active={activeTab === "rides"} />
        <SummaryTile label="Leituras do painel" {...summary.reads} onClick={() => setTab("costs")} active={false} />
      </div>

      <div className="tech-tabs" role="tablist" aria-label="Detalhe técnico">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            className={activeTab === item.id ? "tech-tab tech-tab-active" : "tech-tab"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === "services" && problems.length ? <span className="tech-tab-count">{problems.length}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="tech-panel">
        {activeTab === "services" ? <ServicesView domains={domains} sources={sources} /> : null}
        {activeTab === "costs" ? <CostsView costControls={costControls} snapshot={snapshot} /> : null}
        {activeTab === "rides" ? <RidesView anomaly={anomaly} /> : null}
        {activeTab === "canary" ? <CanaryPackPanel canaryPack={snapshot?.canaryPack} /> : null}
      </div>
    </div>
  );
}
