jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({ usePrototypeRideRuntime: () => ({}) }));
jest.mock('../src/screens/prototype/prototypeMapOcclusion', () => ({ usePrototypeMapOcclusion: () => {} }));

import { resolveDriverActivationSteps } from '../src/screens/prototype/RobotaxiDriverDocumentsScreen';

describe('resolveDriverActivationSteps', () => {
  it('conta as 4 etapas quando nada foi feito', () => {
    const result = resolveDriverActivationSteps({}, false);
    expect(result.remaining).toBe(4);
    expect(result.summary).toBe('Faltam 4 etapas para ficar online');
  });

  it('usa o singular quando falta só a verificação de rosto', () => {
    const result = resolveDriverActivationSteps({
      documents: { cnh: { status: 'approved' }, crlv: { status: 'approved' } },
      checklist: { backgroundCheckConsent: true, vehicleRegistration: true },
      activationState: 'APPROVED_NEEDS_LIVENESS',
      requiresLiveness: true,
    }, false);
    expect(result.remaining).toBe(1);
    expect(result.summary).toBe('Falta 1 etapa para ficar online');
    expect(result.steps.find(step => step.id === 'face').done).toBe(false);
  });

  it('fica pronto quando o backend libera o online', () => {
    const result = resolveDriverActivationSteps({ activationState: 'ACTIVE' }, true);
    expect(result.remaining).toBe(0);
    expect(result.summary).toBe('Tudo pronto para ficar online');
  });
});
