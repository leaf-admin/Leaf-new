describe('prometheus operational events', () => {
  it('exports canonical low-cardinality operational counters without PII', async () => {
    jest.resetModules();
    const { metrics, getMetrics } = require('../../../utils/prometheus-metrics');

    metrics.recordOperationalEvent('payment', 'pix_create', 'failure');
    const output = await getMetrics();

    expect(output).toContain('leaf_operational_event_total');
    expect(output).toContain('domain="payment",event="pix_create",result="failure"');
  });

  it('exports AWS KYC admission capacity, wait and active-session telemetry', async () => {
    jest.resetModules();
    const { metrics, getMetrics } = require('../../../utils/prometheus-metrics');

    metrics.recordKycAwsAdmission('create', 'concurrency_limited', 0);
    metrics.setKycAwsAdmissionActiveSessions(70);
    const output = await getMetrics();

    expect(output).toContain('leaf_kyc_aws_admission_total');
    expect(output).toContain('operation="create",outcome="concurrency_limited"');
    expect(output).toContain('leaf_kyc_aws_admission_wait_seconds');
    expect(output).toContain('leaf_kyc_aws_admission_active_sessions 70');
  });
});
