jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));

const mockSdkInstances = [];
jest.mock('@opentelemetry/sdk-node', () => {
  const actual = jest.requireActual('@opentelemetry/sdk-node');
  class FakeNodeSDK {
    constructor(config) { this.config = config; mockSdkInstances.push(this); }
    start() {}
    shutdown() { return Promise.resolve(); }
  }
  return { ...actual, NodeSDK: FakeNodeSDK, node: { ...actual.node, NodeSDK: FakeNodeSDK } };
});

const ENV_KEYS = ['TEMPO_ENDPOINT', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORT_TO_LOCAL_SINK', 'OTEL_ENABLED', 'NODE_ENV', 'OTEL_SAMPLING_RATE'];
const saved = {};

function loadTracer(env) {
  jest.resetModules();
  mockSdkInstances.length = 0;
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  return require('../../../utils/tracer');
}

describe('tracer collector handling', () => {
  beforeAll(() => { for (const key of ENV_KEYS) saved[key] = process.env[key]; });
  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });

  test('without a collector no SDK is started, the tracer is memoised and shutdown is immediate', async () => {
    const tracer = loadTracer({ NODE_ENV: 'production' });
    const first = tracer.getTracer();
    const second = tracer.getTracer();

    expect(mockSdkInstances).toHaveLength(0);
    expect(second).toBe(first);
    expect(first.startSpan('x').isRecording()).toBe(false);
    await expect(tracer.shutdown()).resolves.toBeUndefined();
  });

  test('with a collector the SDK applies the environment sampling rate', () => {
    const tracer = loadTracer({ NODE_ENV: 'production', TEMPO_ENDPOINT: 'http://tempo:4318', OTEL_SAMPLING_RATE: '0.02' });
    tracer.getTracer();

    expect(mockSdkInstances).toHaveLength(1);
    const sampler = mockSdkInstances[0].config.sampler;
    expect(sampler).toBeDefined();
    expect(String(sampler.toString())).toMatch(/TraceIdRatioBased\{0\.02\}/);
  });

  test('OTEL_EXPORT_TO_LOCAL_SINK keeps the previous local-sink export', () => {
    const tracer = loadTracer({ NODE_ENV: 'production', OTEL_EXPORT_TO_LOCAL_SINK: 'true' });
    tracer.getTracer();
    expect(mockSdkInstances).toHaveLength(1);
  });
});
