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
      <section><h3>R$ 0,99 por corrida, com o Pix incluso.</h3>
        <p>Nas 25 primeiras corridas concluídas no destino, esse é o total que você paga, para qualquer valor de corrida. É uma condição promocional e pode ser alterada.</p></section>
      <section><h3>Depois da promoção, o Pix é cobrado à parte.</h3>
        <p>Vale a tabela regular da Leaf, mais o custo do operador do Pix: <strong>0,8% do valor da transação, com mínimo de R$ 0,50</strong>.</p></section>
      <div class="fee-example"><p>Exemplo: corrida de <strong>R$ 100,00</strong></p>
        <dl><div><dt>Taxa na promoção</dt><dd>R$ 0,99</dd></div><div><dt>Repasse na promoção</dt><dd>R$ 99,01</dd></div><div><dt>Taxas na tabela regular</dt><dd>R$ 3,80</dd></div><div><dt>Repasse na tabela regular</dt><dd>R$ 96,20</dd></div></dl></div>
      <p class="fees-small-print">O operador do Pix é responsável por processar o pagamento digital. Os exemplos não incluem pedágios ou outros repasses.</p>
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
