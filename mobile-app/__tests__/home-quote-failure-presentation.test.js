import { resolveHomeQuoteFailurePresentation } from '../src/screens/prototype/home/homeQuoteFailurePresentation';

describe('home quote failure presentation', () => {
  it('preserves pickup coverage reason through the normalized HTTP error layer', () => {
    const axiosError = Object.assign(new Error('Request failed with status code 422'), {
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 422,
        data: {
          code: 'PICKUP_OUTSIDE_REGION',
          message: 'Origem fora da região de operação permitida',
        },
      },
    });
    const normalizedError = Object.assign(
      new Error('Não foi possível processar sua solicitação agora.'),
      { originalError: axiosError },
    );

    expect(resolveHomeQuoteFailurePresentation(normalizedError)).toEqual({
      kind: 'coverage',
      message: 'Sua origem está fora da área da Leaf.',
      actionLabel: 'Origem fora da área',
    });
  });

  it('distinguishes a destination outside the operational polygon', () => {
    expect(
      resolveHomeQuoteFailurePresentation({
        response: {
          data: {
            code: 'DESTINATION_OUTSIDE_REGION',
            message: 'Destino fora da região de operação permitida',
          },
        },
      }),
    ).toEqual({
      kind: 'coverage',
      message: 'Seu destino está fora da área da Leaf.',
      actionLabel: 'Destino fora da área',
    });
  });

  it('preserves the pickup coverage reason after the message is stored in state', () => {
    expect(
      resolveHomeQuoteFailurePresentation('Sua origem está fora da área da Leaf.'),
    ).toEqual({
      kind: 'coverage',
      message: 'Sua origem está fora da área da Leaf.',
      actionLabel: 'Origem fora da área',
    });
  });

  it('keeps non-coverage quote failures generic', () => {
    expect(
      resolveHomeQuoteFailurePresentation(new Error('Serviço temporariamente indisponível')),
    ).toEqual({
      kind: 'unavailable',
      message: 'Serviço temporariamente indisponível',
      actionLabel: 'Tarifa indisponível',
    });
  });
});
