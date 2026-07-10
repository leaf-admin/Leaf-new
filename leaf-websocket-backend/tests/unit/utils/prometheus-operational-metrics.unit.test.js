describe('prometheus operational events', () => {
  it('exports canonical low-cardinality operational counters without PII', async () => {
    jest.resetModules();
    const { metrics, getMetrics } = require('../../../utils/prometheus-metrics');

    metrics.recordOperationalEvent('payment', 'pix_create', 'failure');
    const output = await getMetrics();

    expect(output).toContain('leaf_operational_event_total');
    expect(output).toContain('domain="payment",event="pix_create",result="failure"');
  });
});
