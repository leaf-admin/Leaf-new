class N1Agent {
  buildRecommendation({ classification, ticket }) {
    if (classification.supportTier !== "N1") {
      return {
        action: "handoff",
        reply: "Vou encaminhar seu caso para o time responsavel e manter o atendimento registrado no ticket.",
      };
    }

    if (!classification.playbookReferences.length) {
      return {
        action: "ask_clarifying_question",
        reply: "Para seguir com seguranca, preciso de mais detalhes sobre o que aconteceu e em qual etapa do app o problema apareceu.",
      };
    }

    const subject = ticket.subject || ticket.title || "seu atendimento";
    return {
      action: classification.canAutoReply ? "auto_reply" : "suggest_reply",
      reply:
        `Entendi o ponto sobre ${subject}. Vou seguir o playbook de suporte, validar o contexto do seu cadastro/corrida e registrar o proximo passo aqui no atendimento.`,
    };
  }
}

module.exports = N1Agent;
