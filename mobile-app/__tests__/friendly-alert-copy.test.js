import { toUserFriendlyMessage } from '../src/utils/friendlyErrorMessages';

describe('toUserFriendlyMessage', () => {
  it('keeps ordinary payment copy', () => {
    expect(toUserFriendlyMessage('Tem certeza que deseja cancelar o pagamento?')).toBe(
      'Tem certeza que deseja cancelar o pagamento?',
    );
  });

  it('still replaces a payment failure', () => {
    expect(toUserFriendlyMessage('Pagamento recusado pelo provedor')).toBe(
      'Não foi possível processar o pagamento via Pix. Tente novamente.',
    );
  });
});
