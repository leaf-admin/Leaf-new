const {
  H3VisualPolicyService,
  helpers
} = require('../../../services/h3-visual-policy-service');

describe('H3VisualPolicyService', () => {
  test('normaliza limites operacionais e template da tag', () => {
    const policy = helpers.normalizePolicy({
      opacity: 9,
      resolutionOffset: -8,
      palette: {
        yellow: '#abcdef',
        red: 'invalid'
      },
      label: {
        minPercent: 0,
        maxVisible: 999,
        template: 'tarifa {percent}',
        fontSize: 99
      }
    });

    expect(policy.opacity).toBe(1);
    expect(policy.resolutionOffset).toBe(-1);
    expect(policy.palette.yellow).toBe('#ABCDEF');
    expect(policy.palette.red).toBe('#EF4444');
    expect(policy.label.minPercent).toBe(1);
    expect(policy.label.maxVisible).toBe(8);
    expect(policy.label.template).toBe('tarifa {percent}');
    expect(policy.label.fontSize).toBe(16);
  });

  test('usa cache para evitar leitura repetida do Firestore', async () => {
    const service = new H3VisualPolicyService({ cacheTtlMs: 60_000 });
    service.cache = {
      loadedAt: Date.now(),
      policy: helpers.normalizePolicy({ opacity: 0.55, version: 4 })
    };

    await expect(service.getPolicy()).resolves.toMatchObject({
      opacity: 0.55,
      version: 4
    });
  });
});
