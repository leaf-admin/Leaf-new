"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import { useAuth } from "@/src/contexts/AuthContext";
import useConfirmAction from "@/src/hooks/useConfirmAction";

const DOCUMENT_OPTIONS = [
  { value: "cnh", label: "CNH" },
  { value: "crlv", label: "CRLV" },
  { value: "antecedentes_criminais", label: "Antecedentes" },
];
const PUSH_ALLOWED_ROLES = new Set(["admin", "super-admin", "manager", "development"]);
const OPERATIONAL_MUTATION_ROLES = new Set(["admin", "super-admin", "manager", "development"]);
const OPERATIONAL_DOCUMENT_TYPES = new Set(["cnh", "crlv", "antecedentes_criminais"]);

function summarizeDirectPushResponse(response) {
  const data = response?.data || response || {};
  const summary = data?.summary || response?.summary || {};
  const sent = Number(summary.success ?? data.sent ?? data.successful ?? response?.sent ?? response?.successful ?? 0);
  const failed = Number(summary.failed ?? data.failed ?? response?.failed ?? 0);
  const target = Number(data.sentTo ?? summary.total ?? data.total ?? response?.total ?? sent + failed);

  return { sent, failed, target };
}

function formatDocumentRequestMessage(result) {
  if (result?.push?.success) return "Documento solicitado e push enviado ao motorista.";
  if (result?.push?.skipped) return "Documento solicitado sem envio de push.";
  return "Documento solicitado. O backend não confirmou entrega de push.";
}

export default function UserDetailsPage({ params }) {
  const resolvedParams = use(params);
  const id = String(resolvedParams?.id || "").trim();
  const mountedRef = useRef(false);
  const { user: authUser } = useAuth();
  const [user, setUser] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [suspendDays, setSuspendDays] = useState("");
  const [pushTitle, setPushTitle] = useState("Atualização da sua conta Leaf");
  const [pushBody, setPushBody] = useState("Temos uma atualização importante para você no app.");
  const [documentType, setDocumentType] = useState("cnh");
  const [documentReason, setDocumentReason] = useState("Precisamos que você envie ou atualize este documento no app.");
  const canSendPush = PUSH_ALLOWED_ROLES.has(String(authUser?.role || "").toLowerCase());
  const canMutateAccount = OPERATIONAL_MUTATION_ROLES.has(String(authUser?.role || "").toLowerCase());
  const canRequestDocument = OPERATIONAL_MUTATION_ROLES.has(String(authUser?.role || "").toLowerCase());
  const { requestConfirmation, confirmationDialog, confirmationOpen } = useConfirmAction();

  const loadUser = useCallback(async ({ silent = false } = {}) => {
    if (!id) return;
    try {
      if (!silent && mountedRef.current) setLoading(true);
      if (mountedRef.current) setError("");
      const userData = await leafAPI.getUserDetails(id);
      if (!mountedRef.current) return;
      setUser(userData);
      setDriverData(null);
      setDocuments(null);

      const isDriverProfile = userData?.type === "driver" || userData?.usertype === "driver";
      if (isDriverProfile) {
        const [complete, docs] = await Promise.all([
          leafAPI.getDriverComplete(id).catch(() => null),
          leafAPI.getDriverDocuments(id).catch(() => null),
        ]);
        if (!mountedRef.current) return;
        setDriverData(complete);
        setDocuments(docs?.data || docs);
      }
    } catch (err) {
      if (mountedRef.current) setError(err?.message || "Falha ao carregar usuário");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      if (!mountedRef.current) return;
      await loadUser();
    };
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [loadUser]);

  const current = driverData || user;
  const isDriver = current?.type === "driver" || current?.usertype === "driver" || !!driverData;
  const operationalDocuments = useMemo(() => {
    const allDocs = documents?.documents?.all_documents;
    const source = Array.isArray(allDocs)
      ? allDocs
      : Object.entries(documents?.documents || {}).map(([type, doc]) => ({ type, ...(doc || {}) }));

    return source.filter((doc) => OPERATIONAL_DOCUMENT_TYPES.has(String(doc?.type || "").toLowerCase()));
  }, [documents?.documents]);
  const docsCount = operationalDocuments.length;
  const requestedDocsCount = operationalDocuments.filter(
    (doc) => String(doc?.requestStatus || "").toLowerCase() === "requested" || doc?.requiredUpdate === true,
  ).length;
  const currentStatus = String(current?.status || user?.status || "").toLowerCase();
  const isSuspended = currentStatus === "suspended" || current?.suspended === true || user?.suspended === true;
  const isBlocked = currentStatus === "blocked" || current?.blocked === true || user?.blocked === true;
  const canReactivate = isSuspended || isBlocked;
  const actionDisabled = Boolean(busyAction);
  const primaryName = current?.name || current?.displayName || "usuário";
  const statusHelper = useMemo(() => {
    if (isBlocked) return "A conta está bloqueada para novas ações operacionais.";
    if (isSuspended) return "A conta está suspensa temporariamente.";
    return "A conta está liberada para uso normal.";
  }, [isBlocked, isSuspended]);

  const runAction = async (actionName, task, successText) => {
    try {
      setBusyAction(actionName);
      setActionError("");
      setActionMessage("");
      const result = await task();
      setActionMessage(typeof successText === "function" ? successText(result) : successText);
      await loadUser({ silent: true });
    } catch (err) {
      setActionError(err?.message || "Não foi possível concluir a ação.");
    } finally {
      setBusyAction("");
    }
  };

  const updateStatus = (status) => runAction(
    `status-${status}`,
    () => leafAPI.updateUserOperationalStatus(id, {
      status,
      reason: statusReason || undefined,
      durationDays: status === "suspended" && suspendDays ? Number(suspendDays) : undefined,
    }),
    status === "active" ? "Conta reativada com sucesso." : "Status da conta atualizado."
  );

  const sendPush = () => runAction(
    "push",
    () => leafAPI.sendPushNotification({
      userIds: [id],
      title: pushTitle,
      body: pushBody,
      data: {
        type: "dashboard_user_message",
        source: "dashboard_user_detail",
        userId: id,
      },
    }),
    (response) => {
      const result = summarizeDirectPushResponse(response);
      return `Push individual concluído: ${result.sent} enviados de ${result.target} alvo(s)` +
        `${result.failed ? `, ${result.failed} falhas` : ""}.`;
    }
  );

  const requestDocument = () => runAction(
    "document-request",
    () => leafAPI.requestDriverDocument(id, documentType, {
      reason: documentReason,
      sendPush: true,
    }),
    formatDocumentRequestMessage
  );

  const requestStatusChange = (status) => requestConfirmation({
    title: status === "blocked" ? "Bloquear conta?" : status === "suspended" ? "Suspender conta?" : "Reativar conta?",
    description: status === "blocked"
      ? "A conta ficará bloqueada para novas ações operacionais."
      : status === "suspended"
        ? "A conta ficará suspensa pelo período informado, se houver."
        : "A conta voltará a ficar liberada para uso normal.",
    detail: `Usuário: ${primaryName}. Motivo: ${statusReason.trim() || "não informado"}.`,
    confirmLabel: status === "blocked" ? "Bloquear" : status === "suspended" ? "Suspender" : "Reativar",
    tone: status === "active" ? "warning" : "danger",
    task: () => updateStatus(status),
  });

  const requestPush = () => requestConfirmation({
    title: "Enviar push individual?",
    description: "A mensagem será enviada imediatamente ao dispositivo do usuário, se houver token ativo.",
    detail: `Título: ${pushTitle.trim() || "(vazio)"}`,
    confirmLabel: "Enviar push",
    tone: "warning",
    task: sendPush,
  });

  const requestDocumentAction = () => requestConfirmation({
    title: "Solicitar documento?",
    description: "O motorista receberá uma solicitação de atualização documental e poderá receber um push.",
    detail: `Documento: ${documentType.toUpperCase()}. Motivo: ${documentReason.trim() || "não informado"}.`,
    confirmLabel: "Solicitar documento",
    tone: "warning",
    task: requestDocument,
  });

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Detalhes do Usuário</h1>
          <Link href="/users">Voltar</Link>
        </header>
        <AppNav />

        {current ? (
          <section className="grid">
            <article className="card">
              <h2>Perfil</h2>
              <KeyValueGrid
                data={{
                  id: current?.id || current?.uid || id,
                  nome: current?.name || current?.displayName || "-",
                  email: current?.email || "-",
                  telefone: current?.phone || current?.phoneNumber || "-",
                  tipo: current?.type || current?.usertype || "-",
                  status: current?.status || "-",
                  cidade: current?.city || current?.cityCode || "-",
                }}
                labels={{
                  id: "ID",
                  nome: "Nome",
                  email: "E-mail",
                  telefone: "Telefone",
                  tipo: "Tipo",
                  status: "Status",
                  cidade: "Cidade",
                }}
              />
              <TechnicalDetails title="Ver payload técnico do perfil" data={current} />
            </article>

            <article className="card">
              <h2>Operação da conta</h2>
              <p className="table-muted">{statusHelper}</p>
              <div className="form-grid form-grid-tight">
                <label className="form-field">
                  Motivo
                  <textarea
                    value={statusReason}
                    onChange={(event) => setStatusReason(event.target.value)}
                    placeholder={`Explique o motivo da ação para ${primaryName}.`}
                  />
                </label>
                <label className="form-field">
                  Dias de suspensão
                  <input
                    type="number"
                    min="1"
                    value={suspendDays}
                    onChange={(event) => setSuspendDays(event.target.value)}
                    placeholder="Opcional"
                  />
                </label>
              </div>
              {canMutateAccount ? (
                <div className="panel-actions">
                  <button
                    className="button-secondary"
                    disabled={actionDisabled || confirmationOpen}
                    onClick={() => requestStatusChange("suspended")}
                  >
                    Suspender
                  </button>
                  <button
                    className="button-danger"
                    disabled={actionDisabled || confirmationOpen}
                    onClick={() => requestStatusChange("blocked")}
                  >
                    Bloquear
                  </button>
                  <button
                    disabled={actionDisabled || confirmationOpen || !canReactivate}
                    onClick={() => requestStatusChange("active")}
                  >
                    Reativar
                  </button>
                </div>
              ) : <p className="table-muted">Seu perfil pode consultar esta conta, mas não pode alterar seu status.</p>}
            </article>

            {canSendPush ? (
              <article className="card">
                <h2>Push individual</h2>
                <div className="form-grid form-grid-tight">
                  <label className="form-field">
                    Título
                    <input value={pushTitle} onChange={(event) => setPushTitle(event.target.value)} />
                  </label>
                  <label className="form-field">
                    Mensagem
                    <textarea value={pushBody} onChange={(event) => setPushBody(event.target.value)} />
                  </label>
                </div>
                <div className="panel-actions">
                  <button disabled={actionDisabled || confirmationOpen || !pushTitle || !pushBody} onClick={requestPush}>
                    Enviar push
                  </button>
                </div>
              </article>
            ) : null}

            {isDriver ? (
              <article className="card">
                <h2>Documentos</h2>
                <KeyValueGrid
                  data={{
                    documentosEnviados: docsCount,
                    solicitacoesAbertas: requestedDocsCount,
                    statusKyc: documents?.kyc?.status || "not_started",
                    bloqueado: documents?.kyc?.blocked || false,
                    needsReview: documents?.kyc?.needsReview || false,
                    similaridade:
                      typeof documents?.kyc?.similarity === "number"
                        ? `${(documents.kyc.similarity * 100).toFixed(1)}%`
                        : "-",
                  }}
                  labels={{
                    documentosEnviados: "Documentos enviados",
                    solicitacoesAbertas: "Solicitações abertas",
                    statusKyc: "Status KYC",
                    bloqueado: "Bloqueado",
                    needsReview: "Precisa revisão",
                    similaridade: "Similaridade",
                  }}
                />
                <TechnicalDetails title="Ver payload técnico de documentos" data={documents || {}} />
                {canRequestDocument ? (
                  <>
                    <div className="form-grid form-grid-tight">
                      <label className="form-field">
                        Solicitar documento
                        <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
                          {DOCUMENT_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        Mensagem para o motorista
                        <textarea
                          value={documentReason}
                          onChange={(event) => setDocumentReason(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="panel-actions">
                      <button disabled={actionDisabled || confirmationOpen || !documentReason} onClick={requestDocumentAction}>
                        Solicitar documento
                      </button>
                      <Link href={`/drivers/${id}/documents`}>Abrir tela de documentos</Link>
                    </div>
                  </>
                ) : <p className="table-muted">Seu perfil pode consultar documentos, mas não pode solicitar alterações.</p>}
              </article>
            ) : null}
          </section>
        ) : (
          <p>{loading ? "Carregando..." : "Usuário não encontrado."}</p>
        )}

        {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
        {actionError ? <p className="error">{actionError}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {confirmationDialog}
      </main>
    </ProtectedRoute>
  );
}
