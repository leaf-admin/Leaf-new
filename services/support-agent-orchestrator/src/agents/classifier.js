const {
  canAutoReply,
  categoryFromFlags,
  findRiskFlags,
  priorityFromFlags,
  supportTierFromFlags,
} = require("../policies/guardrails");

function compactMessages(messages = [], limit = 12) {
  return messages
    .slice(-limit)
    .map((message) => `${message.senderType || message.senderId || "user"}: ${message.message || message.text || ""}`)
    .join("\n");
}

class SupportClassifier {
  constructor({ playbookStore, minConfidence, autonomousMode }) {
    this.playbookStore = playbookStore;
    this.minConfidence = minConfidence;
    this.autonomousMode = autonomousMode;
  }

  classify({ ticket = {}, messages = [], chatMessages = [] }) {
    const conversationText = [
      ticket.subject,
      ticket.title,
      ticket.description,
      ticket.category,
      compactMessages(messages),
      compactMessages(chatMessages),
    ]
      .filter(Boolean)
      .join("\n");

    const flags = findRiskFlags(conversationText);
    const playbookMatches = this.playbookStore.search(conversationText, { limit: 4 });
    const inferredCategory = categoryFromFlags(flags, ticket.category || "general");
    const priority = priorityFromFlags(flags, ticket.priority);
    const supportTier = supportTierFromFlags(flags);
    const hasClearPlaybook = playbookMatches.length > 0;
    const confidence = Math.min(
      0.96,
      0.42 +
        (hasClearPlaybook ? 0.22 : 0) +
        (flags.length ? 0.18 : 0) +
        (ticket.category ? 0.08 : 0) +
        (ticket.priority ? 0.06 : 0),
    );

    const autoReplyAllowed = canAutoReply({
      flags,
      confidence,
      minConfidence: this.minConfidence,
      autonomousMode: this.autonomousMode,
      playbookMatches,
      approvedMacro: false,
    });

    return {
      category: inferredCategory,
      priority,
      supportTier,
      confidence: Number(confidence.toFixed(2)),
      riskFlags: flags,
      canAutoReply: autoReplyAllowed,
      needsHuman: !autoReplyAllowed,
      playbookVersion: this.playbookStore.version,
      playbookReferences: playbookMatches.map((match) => ({
        title: match.title,
        score: match.score,
        excerpt: match.excerpt,
      })),
      rationale: [
        hasClearPlaybook ? "Playbook encontrou cobertura relacionada." : "Sem cobertura forte no playbook.",
        flags.length ? `Sinais detectados: ${flags.join(", ")}.` : "Sem sinal de risco alto por palavra-chave.",
        autoReplyAllowed
          ? "Resposta automatica permitida pelas politicas."
          : "Copiloto/handoff recomendado; autosend e autoresolve bloqueados.",
      ],
    };
  }
}

module.exports = SupportClassifier;
