const fs = require('fs');
const path = require('path');
const { createSingleFlightGate } = require('../src/components/auth/authFlowSubmission');

describe('onboarding finalization single-flight gate', () => {
  it('shares an in-flight finalization across repeated taps', async () => {
    const gate = createSingleFlightGate();
    let releaseOperation;
    const operation = jest.fn(() => new Promise(resolve => {
      releaseOperation = resolve;
    }));

    const firstAttempt = gate.run(operation);
    const repeatedAttempt = gate.run(jest.fn());

    expect(gate.isRunning()).toBe(true);
    expect(repeatedAttempt).toBe(firstAttempt);
    expect(operation).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(operation).toHaveBeenCalledTimes(1);
    releaseOperation(true);

    await expect(firstAttempt).resolves.toBe(true);
    expect(gate.isRunning()).toBe(false);
  });

  it('releases the gate after a failed attempt so the customer can retry', async () => {
    const gate = createSingleFlightGate();
    const firstError = new Error('temporary network failure');

    await expect(gate.run(() => Promise.reject(firstError))).rejects.toBe(firstError);
    expect(gate.isRunning()).toBe(false);

    await expect(gate.run(() => Promise.resolve('saved'))).resolves.toBe('saved');
    expect(gate.isRunning()).toBe(false);
  });

  it('wires the passenger and driver submit states to the shared finalization gate', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/components/auth/AuthFlow.js'),
      'utf8',
    );

    expect(source).toContain("import { createSingleFlightGate } from './authFlowSubmission';");
    expect(source).toContain('.run(() => finalizeOnboardingOnce(options))');
    expect(source).toContain('<ProfileDataStep');
    expect(source).toContain('<CredentialsStep');
    expect(source).toContain('<DriverEmailStep');
    expect(source.match(/isSubmitting=\{isFinalizing\}/g)).toHaveLength(3);
  });
});
