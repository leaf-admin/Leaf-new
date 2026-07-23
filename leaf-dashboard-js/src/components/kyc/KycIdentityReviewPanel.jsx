"use client";

import { useId, useMemo, useState } from "react";

import ConfirmActionDialog from "../ui/ConfirmActionDialog";
import Panel from "../ui/Panel";

export const PERMANENT_FRAUD_BLOCK_CONFIRMATION_PHRASE = "CONFIRMAR FRAUDE E BLOQUEAR";
export const MIN_KYC_REVIEW_JUSTIFICATION_LENGTH = 20;

const REVIEW_STARTED_STATUSES = new Set([
  "under_review",
  "confirmed_fraud",
  "in_review",
  "reviewing",
  "false_positive",
  "retry_authorized",
  "fraud_confirmed",
  "permanent_blocked",
]);

const FINAL_REVIEW_STATUSES = new Set([
  "confirmed_fraud",
  "closed",
  "false_positive",
  "retry_authorized",
  "fraud_confirmed",
  "permanent_blocked",
]);

const STATUS_PRESENTATION = {
  open: { className: "status-warn", label: "Aguardando análise" },
  pending: { className: "status-warn", label: "Aguardando análise" },
  awaiting_review: { className: "status-warn", label: "Aguardando análise" },
  in_review: { className: "status-warn", label: "Em análise" },
  under_review: { className: "status-warn", label: "Em análise" },
  reviewing: { className: "status-warn", label: "Em análise" },
  false_positive: { className: "status-ok", label: "Falso positivo" },
  retry_authorized: { className: "status-ok", label: "Nova tentativa autorizada" },
  fraud_confirmed: { className: "status-bad", label: "Fraude confirmada" },
  confirmed_fraud: { className: "status-bad", label: "Fraude confirmada" },
  closed: { className: "status-bad", label: "Caso encerrado" },
  permanent_blocked: { className: "status-bad", label: "Bloqueio permanente" },
  expired: { className: "status-bad", label: "Evidência expirada" },
};

const imageGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
};

const imageCardStyle = {
  minWidth: 0,
  overflow: "hidden",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-lg)",
  background: "var(--surface-strong)",
};

const imageHeaderStyle = {
  display: "grid",
  gap: 3,
  padding: "11px 12px",
  borderBottom: "1px solid var(--line)",
};

const imageViewportStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: 280,
  aspectRatio: "4 / 3",
  overflow: "hidden",
  background: "#edf1ed",
};

const imageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  userSelect: "none",
};

const evidenceGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 8,
  margin: 0,
};

const evidenceItemStyle = {
  display: "grid",
  gap: 3,
  minWidth: 0,
  padding: "10px 11px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface-strong)",
};

const restrictedNoticeStyle = {
  display: "grid",
  gap: 5,
  margin: 0,
  padding: "11px 12px",
  border: "1px solid var(--warn-line)",
  borderRadius: "var(--radius-md)",
  background: "var(--warn-bg)",
  color: "var(--warn-text)",
  fontSize: "0.8rem",
};

const actionRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};

function normalizeStatus(value) {
  return String(value || "pending").trim().toLowerCase().replaceAll("-", "_");
}

function presentStatus(value) {
  const normalized = normalizeStatus(value);
  return STATUS_PRESENTATION[normalized] || {
    className: "status-warn",
    label: normalized.replaceAll("_", " "),
  };
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const percent = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  return `${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function isExpired(value) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function EvidenceImage({ src, alt, eyebrow, title, description }) {
  return (
    <article style={imageCardStyle}>
      <header style={imageHeaderStyle}>
        <span className="text-muted" style={{ margin: 0 }}>{eyebrow}</span>
        <strong>{title}</strong>
        <span className="text-muted" style={{ margin: 0 }}>{description}</span>
      </header>
      <div style={imageViewportStyle}>
        {src ? (
          // The host page supplies short-lived protected blob URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            draggable={false}
            style={imageStyle}
          />
        ) : (
          <span className="text-muted" role="img" aria-label={`${alt} indisponível`}>
            Imagem indisponível
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * Presentation-only identity review surface. All evidence URLs and mutations are
 * supplied by the host page so this component never contacts providers directly.
 */
export default function KycIdentityReviewPanel({
  driverId = "",
  driverName = "",
  incidentId = "",
  attemptId = "",
  approvedCnhPortraitUrl = "",
  failedReferenceImageUrl = "",
  reviewStatus = "pending",
  evidence = {},
  retentionExpiresAt = "",
  initialTicketId = "",
  initialJustification = "",
  busyAction = "",
  readOnly = false,
  actionError = "",
  onLoadEvidence,
  onStartReview,
  onAuthorizeRetry,
  onConfirmPermanentBlock,
}) {
  const ticketInputId = useId();
  const justificationInputId = useId();
  const confirmationInputId = useId();
  const [ticketId, setTicketId] = useState(initialTicketId);
  const [justification, setJustification] = useState(initialJustification);
  const [fraudDialogOpen, setFraudDialogOpen] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [confirmationAttempted, setConfirmationAttempted] = useState(false);

  const normalizedReviewStatus = normalizeStatus(reviewStatus);
  const resolvedExpiresAt = retentionExpiresAt || evidence?.expiresAt || "";
  const evidenceExpired = isExpired(resolvedExpiresAt);
  const statusPresentation = presentStatus(evidenceExpired ? "expired" : reviewStatus);
  const hasRequiredImages = Boolean(approvedCnhPortraitUrl && failedReferenceImageUrl);
  const reviewStarted = REVIEW_STARTED_STATUSES.has(normalizedReviewStatus);
  const reviewFinalized = FINAL_REVIEW_STATUSES.has(normalizedReviewStatus);
  const cleanTicketId = ticketId.trim();
  const cleanJustification = justification.trim();
  const hasRequiredReviewContext = Boolean(
    cleanTicketId && cleanJustification.length >= MIN_KYC_REVIEW_JUSTIFICATION_LENGTH,
  );
  const mutationUnavailable = readOnly || Boolean(busyAction) || evidenceExpired;
  const actionsUnavailable = mutationUnavailable || !hasRequiredImages;

  const actionPayload = useMemo(() => ({
    incidentId: incidentId || evidence?.incidentId || "",
    attemptId: attemptId || evidence?.attemptId || "",
    driverId,
    ticketId: cleanTicketId,
    justification: cleanJustification,
  }), [attemptId, cleanJustification, cleanTicketId, driverId, evidence?.attemptId, evidence?.incidentId, incidentId]);

  const metadata = [
    ["Motorista", driverName ? `${driverName}${driverId ? ` · ${driverId}` : ""}` : driverId || "—"],
    ["Incidente", incidentId || evidence?.incidentId || "—"],
    ["Tentativa", attemptId || evidence?.attemptId || "—"],
    ["Resultado do provedor", evidence?.providerDecision || evidence?.decision || "Divergência facial"],
    ["Similaridade", formatPercent(evidence?.similarityPercent ?? evidence?.similarity)],
    ["Limite aplicado", formatPercent(evidence?.thresholdPercent ?? evidence?.threshold)],
    ["Capturada em", formatDateTime(evidence?.capturedAt || evidence?.createdAt)],
    ["Expiração da evidência", formatDateTime(resolvedExpiresAt)],
  ];

  const handlePermanentBlock = async () => {
    if (confirmationPhrase !== PERMANENT_FRAUD_BLOCK_CONFIRMATION_PHRASE) {
      setConfirmationAttempted(true);
      return;
    }

    if (
      !hasRequiredReviewContext ||
      actionsUnavailable ||
      !reviewStarted ||
      reviewFinalized ||
      typeof onConfirmPermanentBlock !== "function"
    ) {
      return;
    }

    await onConfirmPermanentBlock({
      ...actionPayload,
      decision: "fraud_confirmed_permanent_block",
      confirmationPhrase,
    });
    setFraudDialogOpen(false);
    setConfirmationPhrase("");
    setConfirmationAttempted(false);
  };

  return (
    <>
      <Panel
        title="Revisão de identidade"
        subtitle="Compare a CNH aprovada com a imagem exata que foi usada na tentativa de comparação facial reprovada."
        className="kyc-identity-review-panel"
        actions={<span className={statusPresentation.className}>{statusPresentation.label}</span>}
      >
        <aside style={restrictedNoticeStyle} aria-label="Aviso de acesso restrito">
          <strong>Acesso restrito e auditado</strong>
          <span>
            Use estas imagens somente no chamado informado. Não copie, compartilhe ou fotografe esta tela.
            A evidência da falha expira automaticamente conforme a política de retenção.
          </span>
          <span>Selfies aprovadas não são armazenadas; este painel exibe somente falhas elegíveis para revisão.</span>
        </aside>

        <section aria-label="Comparação visual de identidade" style={imageGridStyle}>
          <EvidenceImage
            src={approvedCnhPortraitUrl}
            alt="Retrato da CNH aprovada"
            eyebrow="Documento canônico"
            title="Retrato da CNH aprovada"
            description="Imagem documental validada pelo time de KYC."
          />
          <EvidenceImage
            src={failedReferenceImageUrl}
            alt="Selfie da tentativa reprovada"
            eyebrow="Falha no face compare"
            title="Selfie usada na comparação"
            description="ReferenceImage capturada na sessão de liveness."
          />
        </section>

        <section aria-label="Metadados da evidência">
          <dl style={evidenceGridStyle}>
            {metadata.map(([label, value]) => (
              <div key={label} style={evidenceItemStyle}>
                <dt className="text-muted" style={{ margin: 0 }}>{label}</dt>
                <dd style={{ margin: 0, overflowWrap: "anywhere", fontWeight: 650 }}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="form-separator" />

        <section className="section-stack" aria-label="Registro da análise">
          <div>
            <h3 style={{ margin: 0 }}>Vincular decisão ao chamado</h3>
            <p className="text-muted" style={{ margin: "4px 0 0" }}>
              O chamado e a justificativa acompanham todas as decisões na trilha de auditoria.
            </p>
          </div>

          <div className="form-grid" style={{ alignItems: "start" }}>
            <label className="form-field" htmlFor={ticketInputId}>
              ID do chamado
              <input
                id={ticketInputId}
                name="kycReviewTicketId"
                value={ticketId}
                onChange={(event) => setTicketId(event.target.value)}
                placeholder="Ex.: SUP-2026-001234"
                autoComplete="off"
                required
                disabled={readOnly || Boolean(busyAction)}
              />
            </label>

            <label className="form-field" htmlFor={justificationInputId} style={{ gridColumn: "1 / -1" }}>
              Justificativa da análise
              <textarea
                id={justificationInputId}
                name="kycReviewJustification"
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                placeholder="Descreva o que foi verificado e a base para a decisão."
                minLength={MIN_KYC_REVIEW_JUSTIFICATION_LENGTH}
                required
                disabled={readOnly || Boolean(busyAction)}
              />
              <span className="text-muted" style={{ margin: 0 }}>
                Mínimo de {MIN_KYC_REVIEW_JUSTIFICATION_LENGTH} caracteres · {cleanJustification.length} informados
              </span>
            </label>
          </div>

          {!hasRequiredImages ? (
            <p className="error-banner">A decisão está bloqueada porque uma das imagens de evidência não está disponível.</p>
          ) : null}
          {evidenceExpired ? (
            <p className="error-banner">A evidência expirou. Escalone o chamado; nenhuma decisão pode ser tomada por esta tela.</p>
          ) : null}
          {actionError ? <p className="error-banner" role="alert">{actionError}</p> : null}

          <div style={actionRowStyle}>
            <button
              type="button"
              className="button-secondary"
              disabled={
                mutationUnavailable ||
                !hasRequiredReviewContext ||
                hasRequiredImages ||
                typeof onLoadEvidence !== "function"
              }
              onClick={() => onLoadEvidence?.({ ...actionPayload, decision: "load_evidence" })}
            >
              {busyAction === "load_evidence" ? "Carregando evidências..." : "Carregar evidências restritas"}
            </button>

            <button
              type="button"
              className="primary-action"
              disabled={
                actionsUnavailable ||
                !hasRequiredReviewContext ||
                reviewStarted ||
                typeof onStartReview !== "function"
              }
              onClick={() => onStartReview?.({ ...actionPayload, decision: "start_review" })}
            >
              {busyAction === "start_review" ? "Iniciando análise..." : "Iniciar análise"}
            </button>

            <button
              type="button"
              className="button-secondary"
              disabled={
                actionsUnavailable ||
                !hasRequiredReviewContext ||
                !reviewStarted ||
                reviewFinalized ||
                typeof onAuthorizeRetry !== "function"
              }
              onClick={() => onAuthorizeRetry?.({ ...actionPayload, decision: "false_positive_retry" })}
            >
              {busyAction === "authorize_retry"
                ? "Autorizando tentativa..."
                : "Marcar falso positivo e autorizar tentativa"}
            </button>

            <button
              type="button"
              className="button-danger"
              disabled={
                actionsUnavailable ||
                !hasRequiredReviewContext ||
                !reviewStarted ||
                reviewFinalized ||
                typeof onConfirmPermanentBlock !== "function"
              }
              onClick={() => {
                setConfirmationPhrase("");
                setConfirmationAttempted(false);
                setFraudDialogOpen(true);
              }}
            >
              Confirmar fraude e bloquear permanentemente
            </button>
          </div>

          <p className="text-muted" style={{ margin: 0 }}>
            Uma revisão humana pode autorizar uma única nova tentativa. O bloqueio permanente encerra o acesso operacional
            e exige confirmação reforçada; nenhuma das decisões aprova uma identidade automaticamente.
          </p>
        </section>
      </Panel>

      <ConfirmActionDialog
        open={fraudDialogOpen}
        title="Confirmar fraude e bloqueio permanente"
        description="Use esta decisão somente quando a comparação entre a CNH aprovada e a selfie comprovar tentativa de uso por outra pessoa."
        confirmLabel={busyAction === "permanent_block" ? "Bloqueando..." : "Bloquear permanentemente"}
        cancelLabel="Voltar à análise"
        tone="danger"
        busy={busyAction === "permanent_block"}
        onCancel={() => {
          setFraudDialogOpen(false);
          setConfirmationPhrase("");
          setConfirmationAttempted(false);
        }}
        onConfirm={handlePermanentBlock}
      >
        <div className="section-stack">
          <p>
            Esta ação impede novas ativações e tentativas de KYC. Para confirmar, digite exatamente:{" "}
            <code>{PERMANENT_FRAUD_BLOCK_CONFIRMATION_PHRASE}</code>
          </p>
          <label className="form-field" htmlFor={confirmationInputId}>
            Frase de confirmação
            <input
              id={confirmationInputId}
              name="permanentFraudBlockConfirmation"
              value={confirmationPhrase}
              onChange={(event) => setConfirmationPhrase(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          {confirmationAttempted && confirmationPhrase !== PERMANENT_FRAUD_BLOCK_CONFIRMATION_PHRASE ? (
            <p className="error" role="alert">Digite a frase completa para confirmar o bloqueio.</p>
          ) : null}
        </div>
      </ConfirmActionDialog>
    </>
  );
}
