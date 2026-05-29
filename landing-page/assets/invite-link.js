(function () {
  const configNode = document.querySelector('[data-invite-page]');
  const inviteKind = configNode?.getAttribute('data-invite-kind') === 'driver'
    ? 'driver'
    : 'passenger';

  const routePrefix = inviteKind === 'driver' ? 'motorista/convite' : 'convite';
  const apiBase = configNode?.getAttribute('data-api-base') || 'https://api.leaf.app.br/api';
  const landingFallback = configNode?.getAttribute('data-landing-fallback') || 'https://leaf.app.br/';
  const playStoreUrl = configNode?.getAttribute('data-play-store-url') ||
    'https://play.google.com/store/apps/details?id=br.com.leaf.ride';
  const iosStoreUrl = configNode?.getAttribute('data-ios-store-url') || landingFallback;

  function normalizeCode(value) {
    return String(value || '')
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .split(/[/?#]/)[0]
      .toUpperCase();
  }

  function resolveCode() {
    const query = new URLSearchParams(window.location.search);
    const fromQuery = normalizeCode(query.get('code') || query.get('invite') || query.get('ref'));
    if (fromQuery) return fromQuery;

    const path = window.location.pathname.replace(/^\/+/, '');
    const parts = path.split('/').filter(Boolean);
    const prefixParts = routePrefix.split('/');
    const offset = prefixParts.length;
    const prefixMatches = prefixParts.every((part, index) => parts[index] === part);
    return prefixMatches ? normalizeCode(parts[offset]) : '';
  }

  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  function setHref(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.setAttribute('href', value);
  }

  function getStoreUrl() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return playStoreUrl;
    if (/iphone|ipad|ipod/i.test(ua)) return iosStoreUrl;
    return landingFallback;
  }

  function buildLinks(code) {
    const encoded = encodeURIComponent(code || '');
    const path = `${routePrefix}/${encoded}`;
    return {
      canonical: `https://leaf.app.br/${path}`,
      leafScheme: `leafapp://${path}`,
      androidScheme: `br.com.leaf.ride://${path}`,
      store: getStoreUrl(),
    };
  }

  function tryOpenApp(links) {
    const ua = navigator.userAgent || '';
    const scheme = /android/i.test(ua) ? links.androidScheme : links.leafScheme;
    const startedAt = Date.now();
    window.location.href = scheme;

    window.setTimeout(() => {
      if (document.visibilityState === 'visible' && Date.now() - startedAt < 2200) {
        const fallback = document.querySelector('[data-fallback-note]');
        if (fallback) fallback.classList.remove('hidden');
      }
    }, 1200);
  }

  async function loadInvitePreview(code) {
    if (!code) return null;
    const endpoint = `${apiBase}/programs/referrals/invites/public/${encodeURIComponent(code)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return response.json();
  }

  function renderPreview(payload) {
    const invite = payload?.invite || null;
    if (!invite) return;

    const statusNode = document.querySelector('[data-invite-status]');
    if (statusNode) {
      if (invite.canAccept) {
        statusNode.innerHTML = '<strong>Convite ativo.</strong> Abra o app para aceitar e seguir com seu cadastro.';
      } else {
        statusNode.classList.add('warn');
        statusNode.innerHTML = '<strong>Convite ja utilizado.</strong> Se voce ja aceitou, entre no app com o mesmo telefone.';
      }
    }

    const details = document.querySelector('[data-invite-details]');
    if (details) {
      details.classList.remove('hidden');
    }

    if (invite.kind === 'driver') {
      setText('[data-detail-one-label]', 'Qualificacao');
      setText('[data-detail-one-value]', `${invite.driverReward?.requiredCompletedTrips || 20} corridas`);
      setText('[data-detail-two-label]', 'Recompensa');
      setText('[data-detail-two-value]', `${invite.driverReward?.rewardMonths || 1} mes`);
      return;
    }

    setText('[data-detail-one-label]', 'Beneficio');
    setText('[data-detail-one-value]', `${invite.passengerBenefit?.discountPercent || 10}% off`);
    setText('[data-detail-two-label]', 'Uso');
    setText('[data-detail-two-value]', `${invite.passengerBenefit?.maxDiscountRides || 3} corridas`);
  }

  const code = resolveCode();
  const links = buildLinks(code);

  setText('[data-invite-code]', code || 'CONVITE');
  setHref('[data-open-app]', links.leafScheme);
  setHref('[data-store-link]', links.store);

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && code) canonical.setAttribute('href', links.canonical);

  document.querySelectorAll('[data-open-app]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      tryOpenApp(links);
    });
  });

  if (code) {
    loadInvitePreview(code).then(renderPreview).catch(() => {});
  }

  const shouldAutoOpen =
    code &&
    /android|iphone|ipad|ipod/i.test(navigator.userAgent || '') &&
    !new URLSearchParams(window.location.search).has('no_auto');

  if (shouldAutoOpen) {
    window.setTimeout(() => tryOpenApp(links), 650);
  }
})();
