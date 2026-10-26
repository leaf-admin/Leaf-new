(() => {
  'use strict';

  const input = document.getElementById('rideValue');
  if (!input) return;
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const leafFeeCents = 99;

  function updateCalculation() {
    const value = Number.parseFloat(input.value);
    const rideCents = Math.round(value * 100);
    const validNumber = Number.isFinite(value) && value >= 0 && Number.isSafeInteger(rideCents * 8);
    const pixFeeCents = validNumber ? Math.max(50, Math.floor((rideCents * 8 + 500) / 1000)) : 0;
    const totalCents = leafFeeCents + pixFeeCents;
    const format = cents => money.format(cents / 100);
    const warning = document.getElementById('value-warning');
    const belowMinimum = validNumber && rideCents < 850;
    warning.hidden = !belowMinimum;
    warning.style.display = belowMinimum ? 'block' : 'none';
    input.setAttribute('aria-invalid', String(!validNumber || belowMinimum));

    document.getElementById('leaf-fee').textContent = format(leafFeeCents);
    document.getElementById('payment-fee').textContent = validNumber ? format(pixFeeCents) : '—';
    document.getElementById('total-fees').textContent = validNumber ? format(totalCents) : '—';
    document.getElementById('net-amount').textContent = validNumber ? format(Math.max(0, rideCents - totalCents)) : '—';
    document.getElementById('pix-calculation-note').textContent = validNumber && rideCents > 6250
      ? 'Nesta corrida: 0,8% do valor da transação para o operador do Pix, apresentado em centavos.'
      : 'Até R$ 62,50, aplica-se o mínimo de R$ 0,50 do operador do Pix.';
  }

  input.addEventListener('input', updateCalculation);
  updateCalculation();
})();
