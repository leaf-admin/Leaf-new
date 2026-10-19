"use client";

import { useEffect, useState } from "react";
import Panel from "@/src/components/ui/Panel";
import { leafAPI } from "@/src/services/api";

// O backend guarda o snapshot por ~10 min; recarregar mais que isso não traz nada novo.
const REFRESH_MS = 5 * 60 * 1000;

const formatCount = (value) => Number(value || 0).toLocaleString("pt-BR");
const formatUptime = (value) => (value == null ? "-" : `${Number(value).toFixed(2).replace(".", ",")}%`);

const UPTIME_LABEL = {
  up: "no ar",
  down: "fora do ar",
  seems_down: "instável",
  paused: "pausado",
  not_checked: "aguardando",
};

function SourceState({ source }) {
  if (!source || source.status === "not_configured") {
    return <p className="text-muted">Não configurado no servidor.</p>;
  }
  if (source.status === "error") {
    return <p className="status-warn">Indisponível agora ({source.error || "erro"}).</p>;
  }
  return null;
}

function Rows({ rows }) {
  return (
    <div className="ops-rows">
      {rows.map((row) => (
        <div key={row.label} className="ops-row">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          {row.detail ? <small>{row.detail}</small> : null}
        </div>
      ))}
    </div>
  );
}

function SentryPanel({ source }) {
  const projects = source?.data?.projects || [];
  return (
    <Panel title="Erros" subtitle="Sentry: erros abertos vistos nas últimas 24 h.">
      <SourceState source={source} />
      {projects.map((project) => (
        <div key={project.project}>
          <div className="ops-chip-row">
            <span className={project.unresolvedSeen24h > 0 ? "status-warn" : "status-ok"}>
              {project.project}: {formatCount(project.unresolvedSeen24h)} aberto(s)
            </span>
          </div>
          {project.topIssues.length > 0 ? (
            <Rows
              rows={project.topIssues.slice(0, 3).map((issue) => ({
                label: issue.title,
                value: `${formatCount(issue.events)}x`,
                detail: issue.link ? (
                  <a href={issue.link} target="_blank" rel="noreferrer">abrir no Sentry</a>
                ) : issue.culprit,
              }))}
            />
          ) : null}
        </div>
      ))}
    </Panel>
  );
}

function UptimePanel({ source }) {
  const monitors = source?.data?.monitors || [];
  return (
    <Panel title="Disponibilidade" subtitle="UptimeRobot, checando de fora dos servidores.">
      <SourceState source={source} />
      {source?.status === "ok" && monitors.length === 0 ? <p className="text-muted">Nenhum monitor criado.</p> : null}
      {monitors.length > 0 ? (
        <Rows
          rows={monitors.map((monitor) => ({
            label: monitor.name,
            value: UPTIME_LABEL[monitor.status] || monitor.status,
            detail: `7 dias: ${formatUptime(monitor.uptime7d)} · 30 dias: ${formatUptime(monitor.uptime30d)}`,
          }))}
        />
      ) : null}
    </Panel>
  );
}

function UsagePanel({ posthog, appStore, cloudflare }) {
  const usage = posthog?.data;
  const downloads = appStore?.data;
  const site = cloudflare?.data;
  const lastSiteDay = site?.days?.[site.days.length - 1];
  return (
    <Panel title="Uso e crescimento" subtitle="Últimos 7 dias. Cadastros e corridas oficiais ficam no painel de métricas.">
      <Rows
        rows={[
          posthog?.status === "ok"
            ? {
                label: "Pessoas no app",
                value: `${formatCount(usage.users24h)} hoje`,
                detail: usage.events7d > 0
                  ? `${formatCount(usage.users7d)} em 7 dias · ${formatCount(usage.rageClicks7d)} rage clicks`
                  : "Sem eventos ainda. O app começa a enviar a partir da versão 1.0.8.",
              }
            : { label: "Pessoas no app", value: posthog?.status === "error" ? "indisponível" : "não configurado" },
          appStore?.status === "ok"
            ? {
                label: "Downloads iOS",
                value: formatCount(downloads.downloads7d),
                detail: `${formatCount(downloads.redownloads7d)} reinstalações · ${formatCount(downloads.updates7d)} atualizações`,
              }
            : { label: "Downloads iOS", value: appStore?.status === "error" ? "indisponível" : "não configurado" },
          { label: "Downloads Android", value: "em breve", detail: "Aguardando a chave de relatórios do Play Console." },
          cloudflare?.status === "ok"
            ? {
                label: "Site leaf.app.br",
                value: `${formatCount(site.requests7d)} acessos`,
                detail: `${formatCount(lastSiteDay?.visitors)} visitantes no último dia · ${formatCount(site.threats7d)} ameaças bloqueadas`,
              }
            : { label: "Site leaf.app.br", value: cloudflare?.status === "error" ? "indisponível" : "não configurado" },
        ]}
      />
    </Panel>
  );
}

export default function ExternalInsightsPanels() {
  const [snapshot, setSnapshot] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await leafAPI.getExternalInsights();
        if (!mounted) return;
        setSnapshot(result);
        setFailed(false);
      } catch {
        if (mounted) setFailed(true);
      }
    };
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    load();
    const timer = setInterval(loadWhenVisible, REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  if (failed && !snapshot) {
    return (
      <Panel title="Serviços externos" subtitle="Sentry, PostHog, UptimeRobot, Cloudflare e App Store.">
        <p className="status-warn">Não foi possível carregar os dados externos.</p>
      </Panel>
    );
  }
  if (!snapshot) return null;

  const sources = snapshot.sources || {};
  return (
    <>
      <SentryPanel source={sources.sentry} />
      <UptimePanel source={sources.uptime} />
      <UsagePanel posthog={sources.posthog} appStore={sources.appStore} cloudflare={sources.cloudflare} />
    </>
  );
}
