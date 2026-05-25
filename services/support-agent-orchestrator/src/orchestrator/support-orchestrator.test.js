const assert = require("node:assert/strict");
const test = require("node:test");

const SupportClassifier = require("../agents/classifier");
const N1Agent = require("../agents/n1-agent");
const N2Router = require("../agents/n2-router");
const N3Diagnostics = require("../agents/n3-diagnostics");
const InMemoryStore = require("../storage/in-memory-store");
const SupportOrchestrator = require("./support-orchestrator");

function createPlaybookStore() {
  return {
    version: "test-playbook",
    metadata() {
      return { version: this.version, sections: 1 };
    },
    search(text) {
      const normalized = String(text || "").toLowerCase();
      return normalized.includes("pix") || normalized.includes("login") || normalized.includes("recibo")
        ? [
            {
              title: normalized.includes("pix") ? "PIX em processamento" : "Macro N1 aprovada",
              score: 0.9,
              excerpt: normalized.includes("pix")
                ? "Validar paymentId, chargeId e status no PSP."
                : "Coletar contexto objetivo e sugerir resposta por playbook.",
            },
          ]
        : [];
    },
  };
}

function createOrchestrator(overrides = {}) {
  const playbookStore = createPlaybookStore();
  const config = {
    serviceName: "support-agent-orchestrator-test",
    env: "test",
    automation: {
      autonomousMode: false,
      minConfidence: 0.82,
    },
    polling: {
      enabled: false,
      intervalMs: 1000,
    },
    leaf: {
      apiBaseUrl: "http://localhost",
    },
    redis: {
      enabled: false,
    },
    socket: {
      enabled: false,
    },
  };
  const finalConfig = {
    ...config,
    ...overrides.config,
    automation: {
      ...config.automation,
      ...overrides.config?.automation,
    },
    polling: {
      ...config.polling,
      ...overrides.config?.polling,
    },
    leaf: {
      ...config.leaf,
      ...overrides.config?.leaf,
    },
    redis: {
      ...config.redis,
      ...overrides.config?.redis,
    },
    socket: {
      ...config.socket,
      ...overrides.config?.socket,
    },
  };

  return new SupportOrchestrator({
    config: finalConfig,
    leafApiClient: overrides.leafApiClient || {
      async getTicket() {
        return {};
      },
      async getTicketMessages() {
        return { messages: [] };
      },
      async getChatHistory() {
        return { messages: [] };
      },
    },
    playbookStore,
    classifier: new SupportClassifier({
      playbookStore,
      minConfidence: finalConfig.automation.minConfidence,
      autonomousMode: finalConfig.automation.autonomousMode,
    }),
    n1Agent: new N1Agent(),
    n2Router: new N2Router(),
    n3Diagnostics: new N3Diagnostics(),
    store: overrides.store || new InMemoryStore(),
  });
}

function assertNoAutosendOrAutoresolve(run) {
  assert.equal(run.classification.canAutoReply, false);
  assert.equal(run.classification.needsHuman, true);
  assert.equal(run.recommendation.execution.autoSend, false);
  assert.equal(run.recommendation.execution.autoResolve, false);
  assert.equal(run.recommendation.execution.requiresHumanApproval, true);
  assert.equal(run.audit.autoSend, false);
  assert.equal(run.audit.autoResolve, false);
  assert.equal(run.audit.requiresHumanApproval, true);
  assert.doesNotMatch(JSON.stringify(run), /"action":"auto_reply"/);

  [run.recommendation.n1, run.recommendation.n2, run.recommendation.n3]
    .filter(Boolean)
    .forEach((recommendation) => {
      assert.equal(recommendation.autoSend, false);
      assert.equal(recommendation.autoResolve, false);
      assert.equal(recommendation.requiresHumanApproval, true);
    });
}

test("classifies common payment tickets as guided N1/N2 copilot work", () => {
  const orchestrator = createOrchestrator();

  const run = orchestrator.analyzeChat({
    userId: "customer_1",
    ticket: {
      id: "ticket_pix_1",
      subject: "PIX nao confirmou",
      category: "payment",
    },
    messages: [
      {
        senderType: "customer",
        message: "Paguei no pix e ainda aparece processando.",
      },
    ],
  });

  assert.equal(run.ticketId, "ticket_pix_1");
  assert.equal(run.classification.category, "payment");
  assert.ok(["N1", "N2"].includes(run.classification.supportTier));
  assert.equal(run.audit.playbookVersion, "test-playbook");
  assert.equal(run.audit.contractVersion, "support-orchestrator.v1");
  assert.ok(run.recommendation.nextAction);
  assertNoAutosendOrAutoresolve(run);
});

test("escalates safety or legal risk to N3 diagnostics", () => {
  const orchestrator = createOrchestrator();

  const run = orchestrator.analyzeChat({
    userId: "customer_2",
    ticket: {
      id: "ticket_safety_1",
      subject: "Acidente durante a corrida",
      metadata: { bookingId: "booking_1" },
    },
    messages: [
      {
        senderType: "customer",
        message: "Tive um acidente, estou com medo e preciso de ajuda.",
      },
    ],
  });

  assert.equal(run.classification.supportTier, "N3");
  assert.equal(run.recommendation.nextAction, "technical_or_risk_escalation");
  assert.equal(run.recommendation.n3.correlationKeys.bookingId, "booking_1");
  assertNoAutosendOrAutoresolve(run);
});

test("keeps N1 in guarded copilot mode without autosend or autoresolve", () => {
  const orchestrator = createOrchestrator({
    config: {
      automation: {
        autonomousMode: true,
        minConfidence: 0.7,
      },
    },
  });

  const run = orchestrator.analyzeChat({
    userId: "customer_4",
    ticket: {
      id: "ticket_login_1",
      subject: "Ajuda com login",
      category: "general",
    },
    messages: [
      {
        senderType: "customer",
        message: "Nao consigo fazer login e preciso de orientacao.",
      },
    ],
  });

  assert.equal(run.classification.supportTier, "N1");
  assert.equal(run.audit.mode, "guarded_copilot");
  assert.equal(run.recommendation.n1.action, "suggest_reply");
  assertNoAutosendOrAutoresolve(run);
});

test("keeps N2 route recommendations as human-approved handoffs", () => {
  const orchestrator = createOrchestrator();

  const run = orchestrator.analyzeChat({
    userId: "customer_5",
    ticket: {
      id: "ticket_payment_2",
      subject: "PIX pago mas nao confirmou",
      category: "payment",
    },
    messages: [
      {
        senderType: "customer",
        message: "Paguei o pix e tenho comprovante.",
      },
    ],
  });

  assert.equal(run.classification.supportTier, "N2");
  assert.equal(run.recommendation.n2.action, "route_to_specialist");
  assertNoAutosendOrAutoresolve(run);
});

test("reuses cached ticket analysis unless force is requested", async () => {
  let ticketFetches = 0;
  const orchestrator = createOrchestrator({
    leafApiClient: {
      async getTicket() {
        ticketFetches += 1;
        return {
          id: "ticket_cached_1",
          userId: "customer_3",
          subject: "PIX em processamento",
          category: "payment",
        };
      },
      async getTicketMessages() {
        return { messages: [{ senderType: "customer", message: "pix pendente" }] };
      },
      async getChatHistory() {
        return { messages: [] };
      },
    },
  });

  const first = await orchestrator.analyzeTicket("ticket_cached_1");
  const second = await orchestrator.analyzeTicket("ticket_cached_1");

  assert.equal(first.id, second.id);
  assert.equal(ticketFetches, 1);

  const forced = await orchestrator.analyzeTicket("ticket_cached_1", { force: true });
  assert.notEqual(forced.id, first.id);
  assert.equal(ticketFetches, 2);
});

test("executes only human-approved internal notes with idempotency", async () => {
  const calls = [];
  const orchestrator = createOrchestrator({
    leafApiClient: {
      async sendTicketMessage(ticketId, message, messageType) {
        calls.push({ ticketId, message, messageType });
        return { ok: true, id: "message_1" };
      },
      async escalateTicket() {
        throw new Error("should_not_escalate");
      },
    },
  });
  const run = orchestrator.analyzeChat({
    userId: "customer_6",
    ticket: {
      id: "ticket_note_1",
      subject: "Ajuda com recibo",
      category: "general",
    },
    messages: [{ senderType: "customer", message: "preciso do recibo" }],
  });

  const first = await orchestrator.applyApprovedAction({
    runId: run.id,
    action: "internal_note",
    approvedBy: "agent_1",
    message: "Cliente pediu recibo. Validar corrida e enviar orientacao aprovada.",
    idempotencyKey: "ticket_note_1:note:agent_1",
  });
  const second = await orchestrator.applyApprovedAction({
    runId: run.id,
    action: "internal_note",
    approvedBy: "agent_1",
    message: "Cliente pediu recibo. Validar corrida e enviar orientacao aprovada.",
    idempotencyKey: "ticket_note_1:note:agent_1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].ticketId, "ticket_note_1");
  assert.equal(calls[0].messageType, "internal_note");
  assert.equal(first.action.status, "succeeded");
  assert.equal(second.idempotent, true);
  assert.equal(second.action.id, first.action.id);
  assert.equal(orchestrator.store.getRun(run.id).actions[0].type, "internal_note");
  assert.equal(orchestrator.store.getRun(run.id).actions[0].guardrails.autoSend, false);
});

test("rejects unsupported approved actions before touching Leaf API", async () => {
  let touchedApi = false;
  const orchestrator = createOrchestrator({
    leafApiClient: {
      async sendTicketMessage() {
        touchedApi = true;
      },
      async escalateTicket() {
        touchedApi = true;
      },
    },
  });
  const run = orchestrator.analyzeChat({
    userId: "customer_7",
    ticket: {
      id: "ticket_reject_1",
      subject: "Encerrar ticket",
      category: "general",
    },
    messages: [{ senderType: "agent", message: "resolver" }],
  });

  await assert.rejects(
    () => orchestrator.applyApprovedAction({
      runId: run.id,
      action: "close_ticket",
      approvedBy: "agent_2",
      message: "Pode fechar.",
    }),
    /approved_action_not_allowed/,
  );
  assert.equal(touchedApi, false);
});
