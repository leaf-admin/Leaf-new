(() => {
  'use strict';

  const input = document.getElementById('rideValue');
  if (!input) return;
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  // Promoção: R$ 0,99 é o total da corrida, com o Pix incluso.
  const promoFeeCents = 99;
  // Tabela regular: acompanha DEFAULT_POLICY de services/ride-financial-contract.js.
  const regularLeafFeeCents = rideCents => {
    if (rideCents <= 1000) return 79;
    if (rideCents <= 2500) return 99;
    if (rideCents <= 5000) return 149;
    return Math.round(rideCents * 0.03);
  };

  function updateCalculation() {
    const value = Number.parseFloat(input.value);
    const rideCents = Math.round(value * 100);
    const validNumber = Number.isFinite(value) && value >= 0 && Number.isSafeInteger(rideCents * 8);
    const pixFeeCents = validNumber ? Math.max(50, Math.floor((rideCents * 8 + 500) / 1000)) : 0;
    const regularTotalCents = regularLeafFeeCents(rideCents) + pixFeeCents;
    const format = cents => money.format(cents / 100);
    const warning = document.getElementById('value-warning');
    const belowMinimum = validNumber && rideCents < 850;
    warning.hidden = !belowMinimum;
    warning.style.display = belowMinimum ? 'block' : 'none';
    input.setAttribute('aria-invalid', String(!validNumber || belowMinimum));

    document.getElementById('leaf-fee').textContent = format(promoFeeCents);
    document.getElementById('payment-fee').textContent = validNumber ? 'Incluso' : '—';
    document.getElementById('total-fees').textContent = validNumber ? format(promoFeeCents) : '—';
    document.getElementById('net-amount').textContent = validNumber ? format(Math.max(0, rideCents - promoFeeCents)) : '—';
    document.getElementById('regular-note').textContent = validNumber
      ? `Depois da 25ª corrida, nesta mesma corrida: taxa Leaf de ${format(regularLeafFeeCents(rideCents))}, Pix de ${format(pixFeeCents)} e repasse de ${format(Math.max(0, rideCents - regularTotalCents))}.`
      : '';
  }

  input.addEventListener('input', updateCalculation);
  updateCalculation();
})();
