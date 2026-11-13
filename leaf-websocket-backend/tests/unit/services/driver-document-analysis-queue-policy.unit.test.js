'use strict';

jest.mock('../../../firebase-config', () => ({ getRealtimeDB: jest.fn(), getFirestore: jest.fn() }));
jest.mock('../../../services/driver-activation-state-service', () => ({ resolveDriverActivationState: jest.fn() }));
jest.mock('../../../services/driver-application-service', () => ({ syncDriverApplication: jest.fn() }));
jest.mock('../../../services/ocr-service', () => ({}));
jest.mock('../../../services/document-ai-extraction-service', () => ({}));
jest.mock('../../../services/cnh-face-biometric-service', () => jest.fn());
jest.mock('../../../services/cnh-document-identity-validator', () => ({ validateCnhDocumentIdentity: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));
jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: { recordRealtimeUpdate: jest.fn(), recordHotpathLatency: jest.fn() }
}));
jest.mock('../../../utils/redis-pool', () => ({ getConnection: jest.fn(() => ({})) }));

const mockSendNotificationToUser = jest.fn();
jest.mock('../../../services/fcm-service', () => jest.fn().mockImplementation(() => ({
  initialize: jest.fn().mockResolvedValue(true),
  sendNotificationToUser: mockSendNotificationToUser
})));

const {
  applyDriverDocumentPolicy,
  sendDocumentAdjustmentPush
} = require('../../../services/driver-document-analysis-queue');
const { REASONS } = require('../../../services/driver-document-policy-checks');

const NOW = new Date('2026-11-13T15:00:00Z');
const cnhResult = (data = {}) => ({
  success: true,
  data: { nome: 'FULANO', cpf: '123.456.789-09', categoria: 'B', validade: '10/05/2030', ear: true, ...data }
});

describe('applyDriverDocumentPolicy', () => {
  it('mantém a aprovação e devolve as checagens', async () => {
    const result = await applyDriverDocumentPolicy({
      driverId: 'd1',
      documentType: 'cnh',
      analysisResult: cnhResult(),
      loadContext: async () => ({ contextLoaded: true, accountCpf: '12345678909' }),
      now: NOW
    });
    expect(result.analysisResult.success).toBe(true);
    expect(result.policyChecks.every((item) => item.status === 'ok')).toBe(true);
  });

  it('transforma a aprovação em ajuste quando uma regra falha', async () => {
    const result = await applyDriverDocumentPolicy({
      driverId: 'd1',
      documentType: 'cnh',
      analysisResult: cnhResult({ validade: '01/01/2025' }),
      loadContext: async () => ({ contextLoaded: true, accountCpf: '12345678909' }),
      now: NOW
    });
    expect(result.analysisResult).toMatchObject({ success: false, reason: REASONS.cnhExpired('01/01/2025') });
    expect(result.analysisResult.data.validade).toBe('01/01/2025');
  });

  it('cadastro indisponível não reprova o documento', async () => {
    const result = await applyDriverDocumentPolicy({
      driverId: 'd1',
      documentType: 'crlv',
      analysisResult: { success: true, data: { placa: 'ABC1D23', renavam: '1', modelo: 'X', cor: 'PRETO' } },
      loadContext: async () => { throw new Error('firestore down'); },
      now: NOW
    });
    expect(result.analysisResult.success).toBe(true);
    expect(result.policyChecks.find((item) => item.key === 'crlv_plate_profile').status).toBe('unknown');
  });

  it('não mexe em documento já reprovado nem em outros tipos', async () => {
    const failed = { success: false, reason: REASONS.cnhWithoutEar };
    const loadContext = jest.fn();
    expect(await applyDriverDocumentPolicy({ driverId: 'd1', documentType: 'cnh', analysisResult: failed, loadContext }))
      .toEqual({ analysisResult: failed, policyChecks: null });
    expect(loadContext).not.toHaveBeenCalled();
  });
});

describe('sendDocumentAdjustmentPush', () => {
  beforeEach(() => mockSendNotificationToUser.mockReset());

  it('envia push que abre a tela de documentos com o motivo', async () => {
    mockSendNotificationToUser.mockResolvedValue({ success: true });
    await sendDocumentAdjustmentPush({ driverId: 'd1', documentType: 'cnh', reason: REASONS.cnhWithoutEar });
    expect(mockSendNotificationToUser).toHaveBeenCalledWith('d1', expect.objectContaining({
      title: 'Sua CNH precisa de ajuste',
      body: REASONS.cnhWithoutEar,
      data: expect.objectContaining({ type: 'driver_document_request', documentType: 'cnh', source: 'document_analysis' })
    }));
  });

  it('falha do push não lança erro', async () => {
    mockSendNotificationToUser.mockRejectedValue(new Error('fcm down'));
    await expect(sendDocumentAdjustmentPush({ driverId: 'd1', documentType: 'crlv', reason: '' }))
      .resolves.toMatchObject({ success: false });
  });
});
