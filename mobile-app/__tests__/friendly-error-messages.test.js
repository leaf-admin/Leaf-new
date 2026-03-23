import {
  toUserFriendlyError,
  toUserFriendlyMessage,
} from '../src/utils/friendlyErrorMessages';

describe('friendlyErrorMessages', () => {
  test('maps network failure to user friendly connectivity message', () => {
    const msg = toUserFriendlyMessage('Network request failed', { context: 'api' });
    expect(msg).toBe('Sem conexao com a internet. Verifique sua rede e tente novamente.');
  });

  test('maps timeout code to user friendly timeout message', () => {
    const msg = toUserFriendlyMessage(
      { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' },
      { context: 'api' }
    );
    expect(msg).toBe('A conexao demorou mais que o esperado. Tente novamente.');
  });

  test('uses document upload fallback on empty error state', () => {
    const msg = toUserFriendlyMessage(null, { context: 'document_upload' });
    expect(msg).toBe('Nao foi possivel processar o documento enviado. Tente novamente.');
  });

  test('maps 503 status to service unavailable message', () => {
    const msg = toUserFriendlyMessage({ response: { status: 503 } }, { context: 'api' });
    expect(msg).toBe('Servico temporariamente indisponivel. Tente novamente em alguns minutos.');
  });

  test('sanitizes technical payload into safe fallback message', () => {
    const msg = toUserFriendlyMessage(
      '{"error":"Unhandled exception","stack":"TypeError: cannot read property x"}',
      { context: 'booking' }
    );
    expect(msg).toBe('Nao foi possivel concluir esta acao agora. Tente novamente.');
  });

  test('returns normalized friendly error object with status/code metadata', () => {
    const err = toUserFriendlyError(
      {
        message: 'token expired',
        response: { status: 401, data: { code: 'TOKEN_EXPIRED' } },
      },
      { context: 'auth' }
    );

    expect(err.name).toBe('UserFriendlyError');
    expect(err.message).toBe('Sua sessao expirou. Entre novamente para continuar.');
    expect(err.status).toBe(401);
    expect(err.code).toBe('TOKEN_EXPIRED');
  });
});
