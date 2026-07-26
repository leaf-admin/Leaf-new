import { resolveKycLivenessErrorPresentation } from '../src/components/KYC/kycLivenessErrorPresentation';

const TECHNICAL_TERMS = /aws|redis|firestore|rekognition|liveness|canonic|comparacao facial|comparação facial|compare.?faces?|session\s*id|sessionid|challenge\s*id|challengeid/i;

describe('KYC liveness error presentation', () => {
  test('turns canonical approval failure into a document-review state', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_CANONICAL_APPROVED_CNH_REQUIRED',
      message: 'CNH precisa de aprovacao manual canonica antes da comparacao facial',
    });

    expect(presentation).toEqual({
      title: 'Documentos em análise',
      message: 'Sua documentação ainda está em análise. Avisaremos quando você puder continuar.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('turns a missing face in the approved CNH into a document action', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
      message: 'InvalidParameterException from CompareFaces',
    });

    expect(presentation).toEqual({
      title: 'Atualize sua CNH',
      message: 'Não conseguimos identificar sua foto na CNH enviada. Envie uma nova versão do documento.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test.each([
    'AWS_COMPARE_FACES_LIVENESS_FACE_BOUNDS_REQUIRED',
    'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED',
    'KYC_AWS_REFERENCE_IMAGE_REQUIRED',
  ])('turns a recoverable 422 capture failure into a clean retry action (%s)', (code) => {
    const presentation = resolveKycLivenessErrorPresentation({
      code,
      status: 422,
      retryable: true,
    });

    expect(presentation).toEqual({
      title: 'Captura incompleta',
      message: 'A validação terminou, mas não recebemos uma imagem adequada. Tente novamente.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('keeps a real 423 attempt limit distinct from a recoverable capture failure', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      status: 423,
      retryable: false,
    });

    expect(presentation).toEqual({
      title: 'Limite de tentativas',
      message: 'Você atingiu o limite de tentativas. Tente novamente após o prazo informado.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('shows the actual temporary retry delay without provider terminology', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
      status: 429,
      retryable: true,
      retryAfterSeconds: 121,
    });

    expect(presentation).toEqual({
      title: 'Limite de tentativas',
      message: 'Aguarde 3 minutos para tentar novamente.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('explains a real identity mismatch instead of presenting a permission error', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_CHALLENGE_NOT_PASSED',
      status: 403,
      isMatch: false,
    });

    expect(presentation).toEqual({
      title: 'Identidade não confirmada',
      message: 'Por segurança, não foi possível liberar o modo motorista. Se você acredita que houve um engano, solicite uma análise.',
      allowLocalFallback: false,
      action: 'request_identity_review',
      primaryActionLabel: 'Solicitar análise',
      canRequestReview: true,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(/permiss[aã]o|forbidden/i);
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(/trocar|reenviar|tentar novamente/i);
  });

  test('shows an in-progress message only when the identity review has a traceable case', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      status: 423,
      reviewCaseId: 'case_01HZX9',
      message: 'Sua solicitacao de analise de identidade esta em andamento.',
    });

    expect(presentation).toEqual({
      title: 'Análise em andamento',
      message: 'Sua identidade está sendo analisada. Avisaremos assim que houver uma atualização.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
    expect(presentation).not.toHaveProperty('canRequestReview');
  });

  test.each([
    ['missing case id', undefined],
    ['empty case id', ''],
    ['unsafe case id', '../another-driver-case'],
  ])('does not claim that a review exists when its case is %s', (_label, reviewCaseId) => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      status: 423,
      reviewCaseId,
      message: 'Sua solicitacao de analise de identidade esta em andamento.',
    });

    expect(presentation).toEqual({
      title: 'Nova tentativa necessária',
      message: 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(/solicita[cç][aã]o.*andamento/i);
    expect(presentation).not.toHaveProperty('canRequestReview');
  });

  test('supports an explicit recovery-required response without exposing implementation details', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_IDENTITY_RECOVERY_REQUIRED',
      status: 409,
      reviewCaseId: 'stale_case_01HZX9',
    });

    expect(presentation).toEqual({
      title: 'Nova tentativa necessária',
      message: 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('does not offer a local bypass for infrastructure or provider failures', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_CHALLENGE_REDIS_PERSIST_FAILED',
      message: 'Redis unavailable while reserving AWS liveness challenge',
    });

    expect(presentation.allowLocalFallback).toBe(false);
    expect(presentation.title).toBe('Validação indisponível');
    expect(presentation.message).not.toMatch(TECHNICAL_TERMS);
  });

  test('does not offer a local bypass when the native module is unavailable', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'AWS_LIVENESS_NATIVE_UNAVAILABLE',
      message: 'Modulo nativo de liveness AWS indisponivel',
    });

    expect(presentation.allowLocalFallback).toBe(false);
    expect(presentation.message).toBe('Não foi possível usar a câmera para esta validação.');
    expect(presentation.message).not.toMatch(TECHNICAL_TERMS);
  });

  test('keeps active-trip verification deferred without interrupting the ride', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
    });

    expect(presentation).toEqual({
      title: 'Continue sua corrida',
      message: 'Vamos pedir a validação quando sua corrida terminar.',
      allowLocalFallback: false,
    });
  });

  test('turns a missing internal session binding into a safe retry message', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_AWS_LIVENESS_SESSION_REQUIRED',
      message: 'sessionId é obrigatório',
    });

    expect(presentation).toEqual({
      title: 'Não foi possível iniciar',
      message: 'Não foi possível preparar a validação agora. Tente novamente em alguns minutos.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test.each([
    'KYC_CANONICAL_ROUTE_REQUIRED',
    'KYC_SANDBOX_LEGACY_ROUTE_DISABLED',
    'KYC_IDENTITY_RETRY_BINDING_REQUIRED',
    'KYC_IDENTITY_RETRY_AUTHORIZATION_REQUIRED',
    'KYC_IDENTITY_RETRY_SESSION_BINDING_REQUIRED',
  ])('keeps internal route and retry bindings out of the UI (%s)', (code) => {
    const presentation = resolveKycLivenessErrorPresentation({
      code,
      message: 'canonical sessionId retry authorization binding failed',
    });

    expect(presentation).toEqual({
      title: 'Não foi possível iniciar',
      message: 'Não foi possível preparar a validação agora. Tente novamente em alguns minutos.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('sanitizes the same missing-session error even without a code', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      message: 'SessionID é obrigatório',
    });

    expect(presentation.message).toBe(
      'Não foi possível preparar a validação agora. Tente novamente em alguns minutos.'
    );
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('presents camera permission denial without provider terminology', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_CAMERA_PERMISSION_REQUIRED',
      message: 'Camera permission denied before AWS session dispatch',
    });

    expect(presentation).toEqual({
      title: 'Acesso à câmera necessário',
      message: 'Permita o uso da câmera nos ajustes do celular para fazer a validação.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('presents result timeout with a stable friendly message', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'KYC_AWS_LIVENESS_RESULT_TIMEOUT',
      message: 'Polling timed out while waiting for AWS liveness result',
    });

    expect(presentation).toEqual({
      title: 'A confirmação demorou mais',
      message: 'Não conseguimos confirmar o resultado agora. Tente novamente em alguns instantes.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });

  test('presents user cancellation without provider terminology', () => {
    const presentation = resolveKycLivenessErrorPresentation({
      code: 'AWS_LIVENESS_CANCELLED',
      message: 'AWS native liveness activity cancelled',
    });

    expect(presentation).toEqual({
      title: 'Validação encerrada',
      message: 'Você pode tentar novamente quando estiver pronto.',
      allowLocalFallback: false,
    });
    expect(`${presentation.title} ${presentation.message}`).not.toMatch(TECHNICAL_TERMS);
  });
});
