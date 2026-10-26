(() => {
  'use strict';

  const feeLinks = document.querySelectorAll('[data-fees-dialog]');
  if (!feeLinks.length) return;

  const dialog = document.createElement('dialog');
  if (typeof dialog.showModal !== 'function') return;
  dialog.className = 'fees-dialog';
  dialog.setAttribute('aria-labelledby', 'fees-dialog-title');
  dialog.innerHTML = `
    <div class="fees-dialog-heading">
      <p class="eyebrow">Cada valor, às claras</p>
      <h2 id="fees-dialog-title">Como funcionam as taxas?</h2>
      <form method="dialog"><button class="dialog-close" aria-label="Fechar explicação das taxas" autofocus>×</button></form>
    </div>
    <div class="fees-dialog-content">
      <section><h3>R$ 0,99 é a taxa da Leaf por corrida.</h3>
        <p>Esse valor é uma condição promocional de lançamento. O custo do operador do Pix é cobrado separadamente.</p></section>
      <section><h3>Até R$ 62,50: R$ 1,49 no total.</h3>
        <p>Para uma corrida de até R$ 62,50, são <strong>R$ 0,99 da Leaf + R$ 0,50 do operador do Pix</strong>.</p></section>
      <section><h3>Acima de R$ 62,50, o Pix acompanha o valor.</h3>
        <p>O operador cobra <strong>0,8% do valor da transação, com mínimo de R$ 0,50</strong>. Por isso, acima de R$ 62,50 o cálculo percentual supera esse mínimo. O valor é apresentado em centavos.</p>
        <p>A taxa da Leaf continua em R$ 0,99 por corrida durante a promoção.</p></section>
      <div class="fee-example"><p>Exemplo: corrida de <strong>R$ 100,00</strong></p>
        <dl><div><dt>Taxa Leaf</dt><dd>R$ 0,99</dd></div><div><dt>Operador do Pix</dt><dd>R$ 0,80</dd></div><div><dt>Total das taxas</dt><dd>R$ 1,79</dd></div><div><dt>Repasse estimado</dt><dd>R$ 98,21</dd></div></dl></div>
      <p class="fees-small-print">O operador do Pix é responsável por processar o pagamento digital. Esse custo é separado da taxa da Leaf. Os exemplos não incluem pedágios ou outros repasses.</p>
      <a class="fees-detail-link" href="/taxas">Ver todos os detalhes e as faixas regulares →</a>
    </div>`;
  document.body.append(dialog);

  let opener;
  feeLinks.forEach(link => {
    link.addEventListener('click', event => {
      // Keep the ordinary details page as a fallback for older browsers.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      dialog.showModal();
      document.body.classList.add('fees-dialog-open');
    });
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('fees-dialog-open');
    if (opener?.isConnected) opener.focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
})();
