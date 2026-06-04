const express = require('express');

const router = express.Router();

const APP_PACKAGE = 'br.com.leaf.ride';
const IOS_APP_ID = 'DTA8W5KA5D.br.com.leaf.ride';
const ANDROID_SHA256_FINGERPRINT = 'B8:A2:ED:46:34:36:06:A6:2C:C1:26:92:BE:62:32:3E:29:69:CD:F4:C8:3F:B5:41:80:D9:24:73:8A:7C:9B:F4';

const SUPPORTED_PATHS = [
  '/convite/*',
  '/motorista/convite/*',
  '/viagem/*'
];

function buildAppleAssociation() {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            {
              '/': '/convite/*',
              comment: 'Convites de passageiros Leaf'
            },
            {
              '/': '/motorista/convite/*',
              comment: 'Convites e waitlist de motoristas Leaf'
            },
            {
              '/': '/viagem/*',
              comment: 'Acompanhamento publico de viagens Leaf'
            }
          ],
          paths: SUPPORTED_PATHS
        }
      ]
    }
  };
}

function buildAndroidAssetLinks() {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: APP_PACKAGE,
        sha256_cert_fingerprints: [ANDROID_SHA256_FINGERPRINT]
      }
    }
  ];
}

function sendJsonAssociation(res, payload) {
  res
    .status(200)
    .type('application/json')
    .set('Cache-Control', 'public, max-age=300')
    .send(JSON.stringify(payload));
}

function getPublicUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}${req.originalUrl}`;
}

function getTripId(req) {
  return String(req.params[0] || '').split('/').filter(Boolean)[0] || '';
}

function renderFallbackPage({ title, description, appHref, canonicalUrl, cta = 'Abrir no app' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Leaf</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonicalUrl}">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 28px;
      background: #f6f7f4;
      color: #101510;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    }
    main {
      width: min(100%, 440px);
      padding: 28px;
      border: 1px solid rgba(16, 21, 16, 0.1);
      border-radius: 28px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 18px 48px rgba(16, 21, 16, 0.12);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 30px;
      line-height: 1.08;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 22px;
      color: #5f675f;
      font-size: 16px;
      line-height: 1.5;
    }
    a {
      display: inline-flex;
      width: 100%;
      min-height: 52px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: #1a330e;
      color: #fff;
      font-weight: 700;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${description}</p>
    <a href="${appHref}">${cta}</a>
  </main>
</body>
</html>`;
}

router.get('/.well-known/apple-app-site-association', (req, res) => {
  sendJsonAssociation(res, buildAppleAssociation());
});

router.get('/.well-known/assetlinks.json', (req, res) => {
  sendJsonAssociation(res, buildAndroidAssetLinks());
});

router.get('/convite/*', (req, res) => {
  const inviteCode = getTripId(req);
  res.type('html').send(renderFallbackPage({
    title: 'Convite Leaf',
    description: 'Abra o convite no app Leaf para aceitar e acompanhar seus beneficios.',
    appHref: `leafapp://convite/${encodeURIComponent(inviteCode)}`,
    canonicalUrl: getPublicUrl(req)
  }));
});

router.get('/motorista/convite/*', (req, res) => {
  const inviteCode = getTripId(req);
  res.type('html').send(renderFallbackPage({
    title: 'Convite para dirigir na Leaf',
    description: 'Abra o convite no app Leaf para entrar na fila de motoristas e acompanhar seu status.',
    appHref: `leafapp://motorista/convite/${encodeURIComponent(inviteCode)}`,
    canonicalUrl: getPublicUrl(req)
  }));
});

router.get('/viagem/*', (req, res) => {
  const tripId = getTripId(req);
  res.type('html').send(renderFallbackPage({
    title: 'Acompanhar viagem',
    description: 'Abra este link no app Leaf para acompanhar a viagem compartilhada com dados seguros.',
    appHref: `leafapp://viagem/${encodeURIComponent(tripId)}`,
    canonicalUrl: getPublicUrl(req)
  }));
});

module.exports = router;
