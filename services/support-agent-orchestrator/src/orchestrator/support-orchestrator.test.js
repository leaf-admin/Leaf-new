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
      return String(text || "").toLowerCase().includes("pix")
        ? [
            {
              title: "PIX em processamento",
              score: 0.9,
              excerpt: "Validar paymentId, chargeId e status no PSP.",
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

  return new SupportOrchestrator({
    config,
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
      minConfidence: config.automation.minConfidence,
      autonomousMode: config.automation.autonomousMode,
    }),
    n1Agent: new N1Agent(),
    n2Router: new N2Router(),
    n3Diagnostics: new N3Diagnostics(),
    store: overrides.store || new InMemoryStore(),
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
  assert.ok(run.recommendation.nextAction);
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
