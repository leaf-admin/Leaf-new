"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import { classifyDriver, resolveDriverHeadline, resolveDriverSteps } from "@/src/utils/driver-review";

// Ficha do motorista: o mesmo andamento que ele vê no app, os documentos lidos e as decisões
// (aprovar documento, pedir reenvio, aprovação final, bloquear), todas com motivo auditável.

const REJECTION_REASONS = {
  cnh: [
    "CNH sem EAR - Exerce atividade remunerada",
    "CNH vencida a mais de 30 dias",
    "CNH inválida - enviar CNH-e digital em PDF",
  ],
  crlv: [
    "CRLV inválido - enviar CRLV digital em PDF",
    "CRLV - ano do veículo não permitido (apenas são aceitos veículos com no máximo 10 anos de fabricação)",
    "CRLV - marca/modelo do veículo não permitido",
    "CRLV - licenciamento pendente (verificar no campo Exercício se corresponde ao ano atual)",
  ],
};

const DATA_LABELS = {
  nome: "Nome",
  cpf: "CPF",
  dataNascimento: "Nascimento",
  birthDate: "Nascimento",
  nomeMae: "Nome da mãe",
  categoria: "Categoria",
  validade: "Validade",
  ear: "EAR",
  placa: "Placa",
  plate: "Placa",
  marcaModelo: "Modelo",
  model: "Modelo",
  cor: "Cor",
  color: "Cor",
  anoFabricacao: "Ano",
  year: "Ano",
  exercicio: "Exercício",
};

function formatDateTime(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatBirthDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : raw || "-";
}

function ExtractedData({ data }) {
  const entries = Object.entries(data || {})
    .filter(([key, value]) => DATA_LABELS[key] && value !== null && value !== undefined && typeof value !== "object" && String(value).trim());
  if (entries.length === 0) return null;
  return (
    <dl className="driver-extracted">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{DATA_LABELS[key]}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function DriverDetailContent({ id }) {
  const searchParams = useSearchParams();
  const kycScope = String(searchParams.get("kycScope") || "").trim().toLowerCase() === "sandbox" ? "sandbox" : "operational";
  const kycRequestContext = useMemo(() => ({ scope: kycScope }), [kycScope]);
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await leafAPI.getDriverApplication(id, kycRequestContext);
      setApplication(response?.data || response || null);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar o motorista.");
    } finally {
      setLoading(false);
    }
  }, [id, kycRequestContext]);

  useEffect(() => {
    load();
  }, [load]);

  const steps = useMemo(() => resolveDriverSteps(application || {}), [application]);
  const bucket = application ? classifyDriver(application) : null;
  const driver = application?.driver || {};
  const vehicle = application?.vehicleConfig || {};
  const activation = application?.activation || {};
  const canFinalApprove = bucket !== "approved" && bucket !== "rejected" && activation.canGoOnline === true;
  const approvedEvidence = steps.filter((step) => step.status === "approved").map((step) => step.key);

  const openDocument = async (type) => {
    setBusy(`open-${type}`);
    setError("");
    try {
      const file = await leafAPI.getDriverDocumentFile(id, type, kycRequestContext);
      const url = URL.createObjectURL(file.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err?.message || "Não foi possível abrir o documento.");
    } finally {
      setBusy("");
    }
  };

  const openDialog = (next) => {
    setReason(next.defaultReason || "");
    setDialog(next);
  };

  const runDialog = async () => {
    if (!dialog) return;
    const trimmed = reason.trim();
    if (dialog.requiresReason && trimmed.length < 5) {
      setError("Escreva o motivo (mínimo 5 caracteres).");
      return;
    }
    setBusy(dialog.kind);
    setError("");
    setNotice("");
    try {
      if (dialog.kind === "approve-doc") {
        await leafAPI.reviewDriverDocument(id, dialog.type, "approve", "", kycRequestContext);
        setNotice(`${dialog.label} aprovado.`);
      } else if (dialog.kind === "reject-doc") {
        await leafAPI.reviewDriverDocument(id, dialog.type, "reject", trimmed, kycRequestContext);
        setNotice(`Pedimos o reenvio de ${dialog.label}. O motorista é avisado no app.`);
      } else if (dialog.kind === "approve-driver") {
        await leafAPI.approveDriverWithChecks(id, trimmed, approvedEvidence);
        setNotice("Motorista aprovado. Ele já pode ficar online.");
      } else if (dialog.kind === "block-driver") {
        await leafAPI.updateUserOperationalStatus(id, { status: "blocked", reason: trimmed });
        setNotice("Motorista bloqueado.");
      }
      setDialog(null);
      await load();
    } catch (err) {
      setError(err?.message || "Não foi possível concluir a ação.");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <LoadingState message="Carregando motorista..." />;

  return (
    <>
      <header className="header">
        <div>
          <Link href={`/drivers${kycScope === "sandbox" ? "?kycScope=sandbox" : ""}`} className="driver-back">‹ Motoristas</Link>
          <h1>{driver.name || "Motorista"}</h1>
          <p className="muted">
            {driver.phone || "-"}{driver.email ? ` · ${driver.email}` : ""}{driver.city ? ` · ${driver.city}` : ""}
          </p>
        </div>
        <div className="filters">
          {canFinalApprove ? (
            <button
              type="button"
              className="driver-primary"
              data-testid="driver-final-approve"
              onClick={() => openDialog({
                kind: "approve-driver",
                title: "Aprovar motorista",
                description: "O backend confere de novo CNH, CRLV/veículo, validação facial e termos antes de aprovar.",
                confirmLabel: "Aprovar",
                tone: "neutral",
                requiresReason: true,
                defaultReason: "Documentos conferidos no dashboard.",
              })}
            >
              Aprovar motorista
            </button>
          ) : null}
          {bucket !== "rejected" ? (
            <button
              type="button"
              className="button-danger"
              onClick={() => openDialog({
                kind: "block-driver",
                title: "Bloquear motorista",
                description: "O motorista não poderá ficar online até ser reativado.",
                confirmLabel: "Bloquear",
                tone: "danger",
                requiresReason: true,
              })}
            >
              Bloquear
            </button>
          ) : null}
        </div>
      </header>

      <AppNav />

      <section className={`driver-banner driver-banner-${bucket}`} data-testid="driver-status-banner">
        <strong>{resolveDriverHeadline(application || {})}</strong>
        <span>
          {bucket === "approved"
            ? `Aprovado em ${formatDateTime(application?.reviewDate)}`
            : String(application?.autoApproval?.status || "") === "needs_review"
              ? "A aprovação automática parou aqui. Confira e decida."
              : activation.label || "Acompanhe abaixo o que falta."}
        </span>
      </section>

      <section className="grid">
        <Panel title="Andamento" subtitle="O mesmo que o motorista vê no app.">
          <ol className="driver-timeline">
            {steps.map((step) => (
              <li key={step.key} className={`driver-timeline-item driver-step-${step.tone}`}>
                <span className="driver-timeline-node" aria-hidden="true" />
                <div className="driver-timeline-body">
                  <div className="driver-timeline-head">
                    <strong>{step.title}</strong>
                    <span className={`driver-pill driver-pill-${step.tone}`}>{step.label}</span>
                  </div>
                  {step.detail ? <p className="table-muted">{step.detail}</p> : null}
                  {step.document ? (
                    <>
                      <ExtractedData data={step.document.extractedData} />
                      <div className="driver-timeline-actions">
                        {step.document.contentAvailable ? (
                          <button type="button" className="button-secondary" disabled={busy === `open-${step.document.type}`} onClick={() => openDocument(step.document.type)}>
                            {busy === `open-${step.document.type}` ? "Abrindo…" : "Ver documento"}
                          </button>
                        ) : null}
                        {step.status !== "approved" ? (
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => openDialog({ kind: "approve-doc", type: step.document.type, label: step.title, title: `Aprovar ${step.title}`, description: "Confirme que o documento é válido e legível.", confirmLabel: "Aprovar", tone: "neutral" })}
                          >
                            Aprovar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => openDialog({ kind: "reject-doc", type: step.document.type, label: step.title, title: `Pedir reenvio de ${step.title}`, description: "O motorista recebe o motivo no app e envia de novo.", confirmLabel: "Pedir reenvio", tone: "warning", requiresReason: true, options: REJECTION_REASONS[step.document.type] || [] })}
                        >
                          Pedir reenvio
                        </button>
                        <span className="table-muted">Enviado {formatDateTime(step.document.uploadedAt)}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Dados" subtitle="Lidos da CNH e do CRLV.">
          <dl className="driver-extracted driver-extracted-wide">
            <div><dt>CPF</dt><dd>{driver.cpf || "-"}</dd></div>
            <div><dt>Nascimento</dt><dd>{formatBirthDate(driver.birthDate)}</dd></div>
            <div><dt>Nome da mãe</dt><dd>{driver.motherName || "-"}</dd></div>
            <div><dt>Gênero</dt><dd>{driver.genderLabel || "-"}</dd></div>
            <div><dt>Veículo</dt><dd>{[vehicle.activeVehicleModel, vehicle.activeVehicleColor].filter(Boolean).join(" · ") || "-"}</dd></div>
            <div><dt>Placa</dt><dd>{vehicle.activeVehiclePlate || "-"}</dd></div>
            <div><dt>Categoria</dt><dd>{vehicle.category || "-"}</dd></div>
            <div><dt>Cadastro</dt><dd>{formatDateTime(application?.submissionDate)}</dd></div>
          </dl>
          <p className="table-muted driver-advanced">
            Revisão de identidade, configuração de veículo e anexos extras ficam em{" "}
            <Link href={`/drivers/${encodeURIComponent(id)}/documents${kycScope === "sandbox" ? "?kycScope=sandbox" : ""}`}>ferramentas avançadas</Link>.
          </p>
        </Panel>
      </section>

      {notice ? <p className="driver-notice" role="status">{notice}</p> : null}
      <ErrorText message={error} />

      <ConfirmActionDialog
        open={Boolean(dialog)}
        title={dialog?.title}
        description={dialog?.description}
        confirmLabel={dialog?.confirmLabel}
        tone={dialog?.tone}
        busy={Boolean(busy) && busy === dialog?.kind}
        onConfirm={runDialog}
        onCancel={() => setDialog(null)}
      >
        {dialog?.options?.length ? (
          <div className="driver-reason-options">
            {dialog.options.map((option) => (
              <label key={option} className="driver-reason-option">
                <input type="radio" name="driver-reason" checked={reason === option} onChange={() => setReason(option)} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        ) : null}
        {dialog?.requiresReason ? (
          <label className="form-field">
            <span>Motivo</span>
            <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explique a decisão (fica na auditoria)" />
          </label>
        ) : null}
      </ConfirmActionDialog>
    </>
  );
}

export default function DriverDetailPage({ params }) {
  const { id } = use(params);
  return (
    <ProtectedRoute>
      <main className="page-shell">
        <Suspense fallback={<LoadingState message="Carregando motorista..." />}>
          <DriverDetailContent id={decodeURIComponent(id)} />
        </Suspense>
      </main>
    </ProtectedRoute>
  );
}
