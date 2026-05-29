class N3Diagnostics {
  recommend({ classification, ticket }) {
    if (classification.supportTier !== "N3") {
      return null;
    }

    return {
      route: "n3-engineering-safety",
      action: "technical_or_risk_escalation",
      requiresHumanApproval: true,
      autoSend: false,
      autoResolve: false,
      diagnosticChecklist: [
        "Correlacionar ticket com incidentes e alertas ativos.",
        "Buscar traceId, bookingId, userId, paymentId ou incidentId no contexto do ticket.",
        "Verificar logs e metricas da janela do evento.",
        "Se houver relato de motorista diferente do cadastro, acionar revalidacao de identidade sem expor o motivo ao app.",
        "Registrar mitigacao ou pedido objetivo para engenharia/seguranca.",
      ],
      correlationKeys: {
        ticketId: ticket.id || null,
        userId: ticket.userId || ticket.user?.id || null,
        bookingId: ticket.metadata?.bookingId || null,
        paymentId: ticket.metadata?.paymentId || ticket.metadata?.chargeId || null,
        incidentId: ticket.metadata?.incidentId || null,
      },
    };
  }
}

module.exports = N3Diagnostics;
