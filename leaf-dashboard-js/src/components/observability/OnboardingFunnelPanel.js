"use client";

import { useEffect, useState } from "react";
import Panel from "@/src/components/ui/Panel";
import { leafAPI } from "@/src/services/api";

const STEP_LABELS = {
  phone_validation: "Telefone",
  phone_code: "Código",
  profile_selection: "Escolha do perfil",
  profile_data: "Dados do perfil",
  document_data: "Documentos",
  credentials: "Senha",
  driver_contact: "Contato do motorista",
  driver_intro: "Apresentação do motorista",
};
const ROLE_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "customer", label: "Passageiros" },
  { value: "driver", label: "Motoristas" },
  { value: "unknown", label: "Sem perfil" },
];
const DAY_OPTIONS = [7, 14, 30];

function formatPercent(part, total) {
  if (!total) return "-";
  return `${Math.round((part / total) * 100)}%`;
}

export default function OnboardingFunnelPanel() {
  const [days, setDays] = useState(14);
  const [role, setRole] = useState("all");
  // O resultado guarda o período pedido; enquanto não bate com o atual, está carregando.
  const [result, setResult] = useState({ days: null, funnel: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    leafAPI.getOnboardingFunnel({ days })
      .then((data) => { if (!cancelled) setResult({ days, funnel: data, error: "" }); })
      .catch((err) => { if (!cancelled) setResult({ days, funnel: null, error: err?.message || "Falha ao carregar o funil" }); });
    return () => { cancelled = true; };
  }, [days]);

  const loading = result.days !== days;
  const { funnel, error } = result;

  const summary = role === "all" ? funnel?.all : funnel?.roles?.[role];
  const steps = (summary?.steps || []).filter((entry) => entry.people > 0 || entry.step === "phone_validation");
  const top = steps[0]?.people || 0;

  let body;
  if (loading) body = <p className="text-muted">Carregando funil...</p>;
  else if (error) body = <p className="text-muted">{error}</p>;
  else if (funnel?.status === "not_configured") body = <p className="text-muted">PostHog não configurado no servidor.</p>;
  else if (funnel?.status !== "ok") body = <p className="text-muted">PostHog indisponível agora ({funnel?.error || "erro"}).</p>;
  else if (!summary?.people) body = <p className="text-muted">Ninguém começou o cadastro nesse período.</p>;
  else {
    body = (
      <div className="bar-list compact-bars">
        {steps.map((entry, index) => {
          const previous = index > 0 ? steps[index - 1].people : entry.people;
          const pct = top > 0 ? Math.min((entry.people / top) * 100, 100) : 0;
          return (
            <div key={entry.step} className="bar-item">
              <div className="bar-label">
                <span>{STEP_LABELS[entry.step] || entry.step}</span>
                <strong>
                  {entry.people}
                  {index > 0 ? ` · ${formatPercent(entry.people, previous)} da etapa anterior` : ""}
                </strong>
              </div>
              <div className="bar-track">
                <div className="bar-fill bar-default" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        <div className="bar-item">
          <div className="bar-label">
            <span>Cadastro concluído</span>
            <strong>{summary.completed} · {formatPercent(summary.completed, top)} de quem começou</strong>
          </div>
          <div className="bar-track">
            <div className="bar-fill bar-positive" style={{ width: `${top ? Math.min((summary.completed / top) * 100, 100) : 0}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Panel
      title="Funil do cadastro"
      subtitle={`Pessoas que viram cada etapa no app (PostHog), últimos ${days} dias. Inclui aparelhos de QA; quem desligou a análise não aparece.`}
      actions={(
        <div className="filters">
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Perfil">
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Período">
            {DAY_OPTIONS.map((value) => <option key={value} value={value}>{value} dias</option>)}
          </select>
        </div>
      )}
    >
      {body}
      {funnel?.truncated ? <p className="text-muted">Mais de 10 mil pessoas no período; contagem parcial.</p> : null}
    </Panel>
  );
}
