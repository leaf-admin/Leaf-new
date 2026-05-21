const assert = require("node:assert/strict");
const test = require("node:test");

const { requireToken } = require("./api");

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("rejects orchestrator API when dashboard token is not configured", () => {
  const middleware = requireToken({
    security: {
      dashboardToken: "",
      allowMissingDashboardToken: false,
    },
  });
  const response = createResponse();
  let nextCalled = false;

  middleware({ get: () => "" }, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error, "orchestrator_token_not_configured");
});

test("allows explicit missing token bypass only for local test harnesses", () => {
  const middleware = requireToken({
    security: {
      dashboardToken: "",
      allowMissingDashboardToken: true,
    },
  });
  const response = createResponse();
  let nextCalled = false;

  middleware({ get: () => "" }, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, 200);
});

test("requires the configured orchestrator token", () => {
  const middleware = requireToken({
    security: {
      dashboardToken: "server-secret",
      allowMissingDashboardToken: false,
    },
  });
  const response = createResponse();
  let nextCalled = false;

  middleware(
    { get: (header) => (header.toLowerCase() === "x-orchestrator-token" ? "wrong" : "") },
    response,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error, "orchestrator_unauthorized");
});
