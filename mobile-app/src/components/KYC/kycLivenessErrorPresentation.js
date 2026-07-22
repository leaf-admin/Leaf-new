const DOCUMENT_REVIEW_CODES = new Set([
  'KYC_CANONICAL_APPROVED_CNH_REQUIRED',
  'KYC_CANONICAL_CNH_NOT_APPROVED',
]);

const DOCUMENT_REUPLOAD_CODES = new Set([
  'KYC_CANONICAL_DOCUMENT_REUPLOAD_REQUIRED',
  'KYC_CANONICAL_CNH_SUBMISSION_MISSING',
  'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
  'KYC_CNH_PORTRAIT_LAYOUT_UNSUPPORTED',
  'KYC_CNH_PORTRAIT_EXTRACTION_FAILED',
]);

const VALIDATION_IN_PROGRESS_CODES = new Set([
  'KYC_CANONICAL_SESSION_BUSY',
  'KYC_VERIFICATION_IN_PROGRESS',
  'KYC_AWS_LIVENESS_PENDING',
  'KYC_AWS_LIVENESS_DISPATCH_OUTCOME_UNKNOWN',
  'KYC_AWS_LIVENESS_RESUME_REQUIRED',
]);

const ATTEMPTS_EXHAUSTED_CODES = new Set([
  'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
  'AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
]);

const SESSION_EXPIRED_CODES = new Set([
  'AWS_LIVENESS_SESSION_EXPIRED',
  'AWS_LIVENESS_SESSION_NOT_FOUND',
  'KYC_AWS_SESSION_ALREADY_CONSUMED',
  'KYC_CANONICAL_TIMESTAMP_INVALID',
]);

const CAPTURE_INCOMPLETE_CODES = new Set([
  'AWS_COMPARE_FACES_LIVENESS_FACE_BOUNDS_REQUIRED',
  'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED',
  'KYC_AWS_REFERENCE_IMAGE_REQUIRED',
]);

const IDENTITY_MISMATCH_CODES = new Set(['KYC_CHALLENGE_NOT_PASSED']);
const IDENTITY_REVIEW_HOLD_CODES = new Set([
  'KYC_IDENTITY_REVIEW_HOLD',
  'KYC_IDENTITY_RECOVERY_REQUIRED',
]);
const SAFE_REVIEW_CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

const SESSION_SETUP_CODES = new Set([
  'KYC_CANONICAL_ROUTE_REQUIRED',
  'KYC_SANDBOX_LEGACY_ROUTE_DISABLED',
  'KYC_AWS_LIVENESS_SESSION_REQUIRED',
  'AWS_LIVENESS_SESSION_ID_REQUIRED',
  'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED',
  'AWS_LIVENESS_SESSION_BINDING_INVALID',
  'AWS_LIVENESS_SESSION_METADATA_REQUIRED',
  'KYC_IDENTITY_RETRY_BINDING_REQUIRED',
  'KYC_IDENTITY_RETRY_AUTHORIZATION_REQUIRED',
  'KYC_IDENTITY_RETRY_SESSION_BINDING_REQUIRED',
  'KYC_CHALLENGE_NOT_FOUND',
  'KYC_LIVENESS_REQUIRED',
]);

const CAMERA_PERMISSION_CODES = new Set(['KYC_CAMERA_PERMISSION_REQUIRED']);
const RESULT_TIMEOUT_CODES = new Set(['KYC_AWS_LIVENESS_RESULT_TIMEOUT']);
const USER_CANCELLED_CODES = new Set(['AWS_LIVENESS_CANCELLED']);

function extractCode(errorOrResult) {
  return String(
    errorOrResult?.code ||
    errorOrResult?.response?.data?.code ||
    errorOrResult?.payload?.code ||
    '',
  ).trim().toUpperCase();
}

function hasTraceableIdentityReviewCase(errorOrResult) {
  const reviewCaseId = String(
    errorOrResult?.reviewCaseId ||
    errorOrResult?.response?.data?.reviewCaseId ||
    errorOrResult?.payload?.reviewCaseId ||
    '',
  ).trim();

  return SAFE_REVIEW_CASE_ID_PATTERN.test(reviewCaseId);
}

function hasTraceableIdentityReviewEvidence(errorOrResult) {
  const evidenceId = String(
    errorOrResult?.evidenceId ||
    errorOrResult?.response?.data?.evidenceId ||
    errorOrResult?.payload?.evidenceId ||
    '',
  ).trim();
  const reviewAvailable = [
    errorOrResult,
    errorOrResult?.response?.data,
    errorOrResult?.payload,
  ].some((source) => source?.reviewAvailable === true);

  return reviewAvailable && SAFE_REVIEW_CASE_ID_PATTERN.test(evidenceId);
}

function isInfrastructureCode(code) {
  return /(?:AWS|REDIS|FIRESTORE|REKOGNITION|COMPARE_FACES|COST|STORE|CACHE|CONFIG|PROVIDER|THROTTL|UNAVAILABLE|DISABLED|ACCESS_DENIED|RESOURCENOTFOUND|RESOURCE_NOT_FOUND)/.test(code);
}

export function resolveKycLivenessErrorPresentation(errorOrResult) {
  const code = extractCode(errorOrResult);

  if (DOCUMENT_REVIEW_CODES.has(code)) {
    return {
      title: 'Documentos em análise',
      message: 'Sua documentação ainda está em análise. Avisaremos quando você puder continuar.',
      allowLocalFallback: false,
    };
  }

  if (DOCUMENT_REUPLOAD_CODES.has(code)) {
    return {
      title: 'Atualize sua CNH',
      message: 'Não conseguimos identificar sua foto na CNH enviada. Envie uma nova versão do documento.',
      allowLocalFallback: false,
    };
  }

  if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') {
    return {
      title: 'Continue sua corrida',
      message: 'Vamos pedir a validação quando sua corrida terminar.',
      allowLocalFallback: false,
    };
  }

  if (VALIDATION_IN_PROGRESS_CODES.has(code)) {
    return {
      title: 'Validação em andamento',
      message: code === 'KYC_AWS_LIVENESS_PENDING' || code === 'KYC_AWS_LIVENESS_DISPATCH_OUTCOME_UNKNOWN'
        ? 'Ainda estamos confirmando o resultado. Aguarde alguns segundos.'
        : 'Uma validação já está em andamento. Aguarde alguns segundos.',
      allowLocalFallback: false,
    };
  }

  if (ATTEMPTS_EXHAUSTED_CODES.has(code)) {
    return {
      title: 'Limite de tentativas',
      message: 'Você atingiu o limite de tentativas. Tente novamente após o prazo informado.',
      allowLocalFallback: false,
    };
  }

  if (SESSION_EXPIRED_CODES.has(code)) {
    return {
      title: 'Sessão encerrada',
      message: 'A sessão expirou. Inicie uma nova validação.',
      allowLocalFallback: false,
    };
  }

  if (CAPTURE_INCOMPLETE_CODES.has(code)) {
    return {
      title: 'Captura incompleta',
      message: 'A validação terminou, mas não recebemos uma imagem adequada. Tente novamente.',
      allowLocalFallback: false,
    };
  }

  if (IDENTITY_MISMATCH_CODES.has(code)) {
    return {
      title: 'Identidade não confirmada',
      message: 'Por segurança, não foi possível liberar o modo motorista. Se você acredita que houve um engano, solicite uma análise.',
      allowLocalFallback: false,
      action: 'request_identity_review',
      primaryActionLabel: 'Solicitar análise',
      canRequestReview: true,
    };
  }

  if (IDENTITY_REVIEW_HOLD_CODES.has(code)) {
    if (code === 'KYC_IDENTITY_REVIEW_HOLD' && hasTraceableIdentityReviewCase(errorOrResult)) {
      return {
        title: 'Análise em andamento',
        message: 'Sua identidade está sendo analisada. Avisaremos assim que houver uma atualização.',
        allowLocalFallback: false,
      };
    }

    if (hasTraceableIdentityReviewEvidence(errorOrResult)) {
      return {
        title: 'Identidade não confirmada',
        message: 'Por segurança, não foi possível liberar o modo motorista. Se você acredita que houve um engano, solicite uma análise.',
        allowLocalFallback: false,
        action: 'request_identity_review',
        primaryActionLabel: 'Solicitar análise',
        canRequestReview: true,
      };
    }

    return {
      title: 'Nova tentativa necessária',
      message: 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
      allowLocalFallback: false,
    };
  }

  if (SESSION_SETUP_CODES.has(code)) {
    return {
      title: 'Não foi possível iniciar',
      message: 'Não foi possível preparar a validação agora. Tente novamente em alguns minutos.',
      allowLocalFallback: false,
    };
  }

  if (CAMERA_PERMISSION_CODES.has(code)) {
    return {
      title: 'Acesso à câmera necessário',
      message: 'Permita o uso da câmera nos ajustes do celular para fazer a validação.',
      allowLocalFallback: false,
    };
  }

  if (RESULT_TIMEOUT_CODES.has(code)) {
    return {
      title: 'A confirmação demorou mais',
      message: 'Não conseguimos confirmar o resultado agora. Tente novamente em alguns instantes.',
      allowLocalFallback: false,
    };
  }

  if (USER_CANCELLED_CODES.has(code)) {
    return {
      title: 'Validação encerrada',
      message: 'Você pode tentar novamente quando estiver pronto.',
      allowLocalFallback: false,
    };
  }

  if (code === 'AWS_LIVENESS_NATIVE_UNAVAILABLE') {
    return {
      title: 'Validação indisponível',
      message: 'Não foi possível usar a câmera para esta validação.',
      allowLocalFallback: false,
    };
  }

  if (isInfrastructureCode(code)) {
    return {
      title: 'Validação indisponível',
      message: 'Não foi possível preparar a validação com segurança agora. Tente novamente em alguns minutos.',
      allowLocalFallback: false,
    };
  }

  return {
    title: 'Não foi possível continuar',
    message: 'Não foi possível iniciar a validação agora. Tente novamente em alguns minutos.',
    allowLocalFallback: false,
  };
}

export default resolveKycLivenessErrorPresentation;
