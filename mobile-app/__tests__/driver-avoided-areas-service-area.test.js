import { describeBairroServiceArea } from '../src/screens/prototype/driverAvoidedAreas';

describe('describeBairroServiceArea', () => {
  it('says nothing for a neighbourhood inside the operation area or without an answer', () => {
    expect(describeBairroServiceArea({ name: 'Copacabana', serviceArea: { pickupPossible: true, destinationPossible: true } })).toBe('');
    expect(describeBairroServiceArea({ name: 'Copacabana', serviceArea: null })).toBe('');
    expect(describeBairroServiceArea(null)).toBe('');
  });

  it('explains when rides can only end there, or never reach it', () => {
    expect(describeBairroServiceArea({ name: 'Campo Grande', serviceArea: { pickupPossible: false, destinationPossible: true } }))
      .toBe('Campo Grande fica fora da área de operação: nenhuma corrida começa lá. Evitar tira só as que terminam lá.');
    expect(describeBairroServiceArea({ name: 'Guaratiba', serviceArea: { pickupPossible: false, destinationPossible: false } }))
      .toBe('Guaratiba fica fora da área de operação: nenhuma corrida passa por lá, não precisa evitar.');
  });
});
